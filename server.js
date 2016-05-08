/*
 * (C) Copyright 2016. All rights reserved.
 *
 */
var express = require('express');
var session = require('express-session');
var path = require('path');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var ws = require('ws');
var kurento = require('kurento-client');
var fs = require('fs');
var shortid = require('shortid');
var agSender = require( 'unifiedpush-node-sender');
// Database
var MongoClient = require('mongodb').MongoClient;
var assert = require('assert');
// Connection URL 
var dbUrl = 'mongodb://localhost:27017/FSLiveCoach';

var config = require('./config');

var Sender = require('./sender');
var Receiver = require('./receiver');
var Room = require('./room');

// var as_uri = config.as_uri;
var serverUrl = config.appRTCUrl;
var ws_uri = config.ws_uri;
var port = config.port;

var kurentoClient = null;
var rooms = [];
var recording = false;
var videos_path = "file:///home/ubuntu/FSLiveCoach/static/videos/";  //TODO change absolute path to relative path

var msg_settings = {
        url: "https://aerogear-virtualassist.rhcloud.com/ag-push/",
        applicationId: "80563173-1780-4274-b49f-68434b6b5de0",
        masterSecret: "f932683d-5a8c-47e0-a78f-1b7c7afcaedf"
      },
      message = {
        alert: "Call from Control Centre!"
      },
      options = {
        config: {
            ttl: 3600,
        }
      };

var app = express();

app.use(bodyParser.json({
	type: 'text'
}));

app.use(cookieParser());

var sessionHandler = session({
	secret: 'none',
	rolling: true,
	resave: true,
	saveUninitialized: true
});

app.use(sessionHandler);

/*
 * Server startup
 */

var server = app.listen(port, function() {
	console.log('Server started on port', port);
    connectDB();
});

app.use(function(req, res, next) {
	console.log(req.protocol, req.method, req.path, req.get('Content-Type'));
	next();
});


var wss = new ws.Server({
	server: server,
	path: '/ws'
});

wss.on('connection', function(ws) {
	var sessionId = null;
	var request = ws.upgradeReq;
	var response = {
		writeHead: {}
	};

	sessionHandler(request, response, function(err) {
		sessionId = request.session.id;
		console.log('Connection received with sessionId ' + sessionId);
	});

	ws.on('error', function(error) {
		console.log('Connection ' + sessionId + ' error', error);
		getRoomBySession(sessionId, function(err, room) {
			stopCall(room);
		});
	});

	ws.on('close', function() {
		console.log('Connection ' + sessionId + ' closed');
		getRoomBySession(sessionId, function(err, room) {
			stopCall(room);
		});
	});

	ws.on('message', function(_message) {
		var message = JSON.parse(_message);
		console.log('Connection ' + sessionId + ' received message ', message);
		var clientId = message.clientid ? message.clientid : "empty";
		var roomname = message.roomid ? message.roomid : "emptyID";

		switch (message.cmd) {
			case 'register':
				console.log('register called');
				getRoom(roomname, function(err, room) {
					if (err) {
						console.error(err);
						ws.send(JSON.stringify({
							msg: {},
							error: err
						}));
					}
					if (!room) {
						console.error("Room not found");
						ws.send(JSON.stringify({
							msg: {},
							error: 'Room not found'
						}));
					}
					if (!room.sender) {
						room.sender = new Sender({
							sessionId: sessionId,
							clientId: clientId,
							websocket: ws
						});
					} else {
						room.sender.websocket = ws;
						room.sender.clientId = clientId;
						room.sender.sessionId = sessionId;
					}
					// console.log('sender created', room.sender);
					// console.log(room);
					//TODO: what if already offered?
					if (room.senderSdpOffer) {
						console.log('TODO: got the sdpOffer first');
					}
				});
				break;

			case 'startWebRtc':
				console.log('startWebRtc');
				var sdpOffer = message.sdpOffer;
				var roomName = message.roomName;
				getRoom(roomName, function(err, room) {
					if (!room) {
						return ws.send(JSON.stringify({
							id: 'error',
							message: 'Room not found'
						}));
					}
					// sessionId = request.session.id;
					startWebRtc(room, sessionId, ws, sdpOffer, function(error, sdpAnswer) {
						if (error) {
							console.log(error);
							return ws.send(JSON.stringify({
								id: 'error',
								message: error
							}));
						}
						console.log("startWebRtc response:", sdpAnswer);
						ws.send(JSON.stringify({
							id: 'startResponse',
							sdpAnswer: sdpAnswer
						}));
					});
				});
				break;

			case 'onIceCandidate':
				var roomName = message.roomName;
				getRoom(roomName, function(err, room) {
					if (!room) {
						return ws.send(JSON.stringify({
							id: 'error',
							message: 'Room not found'
						}));
					}
					onIceCandidate(room, sessionId, message.candidate);
				});
				break;

			case 'stop':
				var roomName = message.roomName;
				getRoom(roomName, function(err, room) {
					if (room) {
                        console.log('Stopping room ' + room.roomName);
                        stopCall(room);
					}else{
                        console.log('Stopping room. Error: No room defined.');    
                    }
				});
				break;

            case 'send':
                    console.log('Message sent by the mobile client.');
                    //stopCall('testing'); //TODO get current room name
                    /*getRoom(roomName, function(err, room) {
                        if (room) {
                            console.log('Stopping room ' + room.roomName);
                            stopCall(room);
                        }else{
                            console.log('Stopping room. Error: No room defined.');    
                        }
                    }); */               
                break;
            
            case 'getData':
                connectDB('read_all');
                break;
			default:
				console.log('something else called');
		}
	});
});

/*
*   Methods for mobile clients
*/

app.all('/join/:roomname', function(req, res) {
  console.log('join called', req.body);
  var roomName = req.params.roomname ? req.params.roomname : "empty";

	//create room
	getRoom(roomName, function(err, room) {
		if (err) {
			console.error(err);
			return res.json({
				"result": "ERROR"
			});
		}
		if (!room) {
			room = new Room({
				roomName: roomName
			});
			rooms.push(room);
		}
		console.log(room);

		//generate a client ID
		var clientId = shortid.generate();

		var response = {
	    "params": {
	      "is_initiator": "true",
	      "room_link": "http://" + serverUrl + "/r/" + roomName,
	      "version_info": "{\"gitHash\": \"029b6dc4742cae3bcb6c5ac6a26d65167c522b9f\", \"branch\": \"master\", \"time\": \"Wed Dec 9 16:08:29 2015 +0100\"}",
	      "messages": [],
	      "error_messages": [],
	      "client_id": clientId,
	      "bypass_join_confirmation": "false",
	      "media_constraints": "{\"audio\": true, \"video\": true}",
	      "include_loopback_js": "",
	      "turn_url": "http://" + serverUrl + "/turn",
	      "is_loopback": "false",
	      "wss_url": "ws://" + serverUrl + "/ws",
	      "pc_constraints": "{\"optional\": []}",
	      "pc_config": "{\"rtcpMuxPolicy\": \"require\", \"bundlePolicy\": \"max-bundle\", \"iceServers\": []}",
	      "wss_post_url": "http://" + serverUrl + "",
	      "offer_options": "{}",
	      "warning_messages": [],
	      "room_id": roomName,
	      "turn_transports": ""
	    },
	    "result": "SUCCESS"
	  };
		res.json(response);
	});
});

app.all('/leave/:roomname/:clientId', function(req, res) {
    var roomName = req.params.roomname ? req.params.roomname : "empty";
    var clientId = req.params.clientId ? req.params.clientId : "emptyID";
    console.log('/leave/:'+roomName+'/:'+clientId+' called', req.body.type);
    
    //mobile client disconected
    getRoom(roomName, function(err, room) {
		if (room) {
			stopCall(room);
            ws.send(JSON.stringify({
                id: 'incomingCall',
                from: 'mobile client'
            }));
		}else{
            console.log ('Room not found.');
        }
        
		res.send('todo');
	});
});

app.all('/turn', function(req, res) {
  console.log('/turn called', req.body);

  var response = config.turn;
  res.json(response);
});

app.all('/message/:roomname/:clientId', function(req, res) {
	var roomName = req.params.roomname ? req.params.roomname : "empty";
	var clientId = req.params.clientId ? req.params.clientId : "emptyID";
	var message = req.body;
	console.log('/message/:'+roomName+'/:'+clientId+' called', req.body.type);
    getRoom(roomName, function(err, room) {
		if (err) {
			res.json({
				"result": "ERROR",
				"error": err
			});
		}
		if (!room) {
			console.log ('Room not found.');
		}

		switch (message.type) {
			case 'candidate':
				var sender = room.sender;
				console.log('candidate', message.candidate);
				var rewrittenCandidate = {
					candidate: message.candidate,
					sdpMid: 'sdparta_0',
					sdpMLineIndex: message.label
				};
				// console.log(rewrittenCandidate);

				var candidate = kurento.register.complexTypes.IceCandidate(rewrittenCandidate);

				if (sender.webRtcEndpoint) {
					console.info('appRTC Ice Candidate addIceCandidate', candidate);
					sender.webRtcEndpoint.addIceCandidate(candidate);
				} else {
					//TODO:
					console.info('appRTC Ice Candidate  Queueing candidate', sender.candidateQueue);
					sender.candidateQueue.push(candidate);
				}
				break;
			case 'offer':
				if (room.sender && room.sender.websocket) {
					var sender = room.sender;
					console.log('yay websocket is present');
					var onCandidate = function(event) {
						// console.log("onCandidate");
						var candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
						var candidateAnswer = {
							msg: {
								type: 'candidate',
								label: event.candidate.sdpMLineIndex,
								id: event.candidate.sdpMid,
								candidate: event.candidate.candidate
							},
							error: ''
						};
						sender.websocket.send(JSON.stringify(candidateAnswer));
					};
					startSendWebRtc(room, message.sdp, onCandidate, function(error, sdpAnswer) {
						console.log('started webrtc in POST', error);
						var sendSdpAnswer = {
							msg: {
								type: 'answer',
								sdp: sdpAnswer
							},
							error: ''
						};

						sender.websocket.send(JSON.stringify(sendSdpAnswer));
					});
				} else {
					console.log('no websocket is present');
					room.senderSdpOffer = message.sdp;
				}
				break;
			default:
				console.log('default');
		}
		//just send success
		res.json({
			"result": "SUCCESS"
		});
	});
});

/*
 * Definition of helper classes
 */

function findDocuments(db, callback) {
    // Get the documents collection 
    var collection = db.collection('documents');
    // Find some documents 
    collection.find({}).toArray(function(err, docs) {
        assert.equal(err, null);
        assert.equal(2, docs.length);
        console.log("Found the following records");
        console.dir(docs);
        callback(docs);
    });
}

function connectDB(operation){
    // Use connect method to connect to the Server 
    MongoClient.connect(dbUrl, function(err, db) {
      assert.equal(null, err);
      console.log("Connected correctly to database");

        switch (operation){
            case 'read_all':
                findDocuments(db, function() {
                    db.close();
                });
                break;
            
            default:
                db.close();
                break;
        }
    });
}

function getKurentoClient(callback) {
	if (kurentoClient !== null) {
		return callback(null, kurentoClient);
	}
	kurento(ws_uri, function(error, _kurentoClient) {
		if (error) {
			console.log("Could not find media server at address " + ws_uri);
			return callback("Could not find media server at address" + ws_uri + ". Exiting with error " + error);
		}

		kurentoClient = _kurentoClient;
		callback(null, kurentoClient);
	});
}

function getRecorder(room, callback){
	if (!room) {
		return callback('No Room');
	}
        
    getPipeline(room, function(error, pipeline) {
		if (error) {
			return callback(error);
		}
    
        /*if (room.recorder !== null) {
		  console.log('Retrieving existent recorder.');
		  return callback(null, room.recorder);
        }*/
        
        //Create RecorderEndpoint
        var ts = Math.floor(new Date().getTime() / 1000);
        //TODO Change absolut path to relative path
        uri = videos_path + 'call_' + ts + '.webm';
        var options = {
            uri: uri,
            useEncodedMedia: false
        };
        
        pipeline.create('RecorderEndpoint', {uri: uri}, function (error, _callRecorderEndpoint) {
            if (error) {
                return callback(error);
            }
            room.recorder = _callRecorderEndpoint;
            console.info('Creating Call RecorderEndpoint. File to be recorded: ' + uri);
            return callback(null, room.recorder);
        });
    });    
}

function getPipeline(room, callback) {
	if (!room) {
		return callback('No Room');
	}

	if (room.pipeline !== null) {
		console.log('Retrieving existent pipeline.');
		return callback(null, room.pipeline);
	}
	getKurentoClient(function(error, kurentoClient) {
		if (error) {
			return callback(error);
		}
		kurentoClient.create('MediaPipeline', function(error, _pipeline) {
			if (error) {
				return callback(error);
			}
			room.pipeline = _pipeline;
			return callback(null, room.pipeline);
		});
	});
};

function getRoom(roomName, callback) {
	console.log("Looking for room:", roomName);
	for (var i = 0; i < rooms.length; i++) {
		if (rooms[i].roomName == roomName) {
			return callback(null, rooms[i]);
		}
	}
	return callback(null, null);
};

function getRoomBySession(sessionId, callback) {
	console.log("Looking for room with session:", sessionId);
	for (var i = 0; i < rooms.length; i++) {
		if (rooms[i].sender && rooms[i].sender.sessionId == sessionId) {
			return callback(null, rooms[i]);
		}
	}
	return callback(null, null);
};

function startSendWebRtc(room, sdpOffer, onCandidate, callback) {
    // Create MediaPipeline
    console.info('1. Creating MediaPipeline');
	getPipeline(room, function(error, pipeline) {
		if (error) {
			return callback(error);
		}
		var sender = room.sender;
        console.info('2. Creating sender WebRTCEndpoint');
		pipeline.create('WebRtcEndpoint', function(error, _webRtcEndpoint) {
			if (error) {
				return callback(error);
			}
			sender.webRtcEndpoint = _webRtcEndpoint;

			console.info("Read queue:", sender.candidateQueue);
			if (sender.candidateQueue) {
				while (sender.candidateQueue.length) {
					console.info("Adding candidate from queue.");
					var candidate = sender.candidateQueue.shift();
					sender.webRtcEndpoint.addIceCandidate(candidate);
				}
			}

			sender.webRtcEndpoint.processOffer(sdpOffer, function(error, sdpAnswer) {
				if (error) {
					sender.webRtcEndpoint.release();
					return callback(error);
				}

				sender.webRtcEndpoint.on('OnIceCandidate', function(event) {
					onCandidate(event);
				});

				sender.webRtcEndpoint.gatherCandidates(function(error) {
					if (error) {
                        stopCall(sessionId);
						return callback(error);
					}
				});

				console.info("Sending aerogear message...");           
                sendNotification();
				console.log("sending sdp answer");
				return callback(null, sdpAnswer);
			});
		});
	});
};

function startWebRtc(room, sessionId, ws, sdpOffer, callback) {
	if (!room) {
		return callback('startWebRtc: No Room');
	}

	var sender = room.sender;
	if (!sender || !sender.webRtcEndpoint) {
		return callback('No Sending Endpoint');
	}

	var receiver = room.getOrCreateReceiver({
		sessionId: sessionId,
		websocket: ws
	});
    
	if (!receiver) {
		return callback('Error getting or creating Receiver');
	}

    // Create WebRtc
    console.info('3. Creating receiver WebRTCEndpoint');    
	var pipeline = room.pipeline;
	pipeline.create('WebRtcEndpoint', function(error, _webRtcEndpoint) {
		if (error) {
			return callback(error);
		}
		receiver.webRtcEndpoint = _webRtcEndpoint;

		if (receiver.candidateQueueVideo) {
			while (receiver.candidateQueueVideo.length) {
				console.info("Adding candidate from queue");
				var candidate = receiver.candidateQueueVideo.shift();
				receiver.webRtcEndpoint.addIceCandidate(candidate);
			}
		}

		receiver.webRtcEndpoint.processOffer(sdpOffer, function(error, sdpAnswer) {
			if (error) {
				receiver.webRtcEndpoint.release();
				return callback(error);
			}
            console.info('4. Connecting receiver WebRtcEndpoint to sender WebRtcEndpoint');
			sender.webRtcEndpoint.connect(receiver.webRtcEndpoint, function(error) {
				if (error) {
					receiver.webRtcEndpoint.release();
					console.log(error);
					return callback(error);
				}

				receiver.webRtcEndpoint.on('OnIceCandidate', function(event) {
					var candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
					ws.send(JSON.stringify({
						id: 'iceCandidate',
						candidate: candidate
					}));
				});

				receiver.webRtcEndpoint.gatherCandidates(function(error) {
					if (error) {
                        stopCall(sessionId);
						return callback(error);
					}
				});

                console.info('5. Connecting sender WebRtcEndpoint to receiver WebRtcEndpoint');
				receiver.webRtcEndpoint.connect(sender.webRtcEndpoint, function(error) {
					if (error) {
						receiver.webRtcEndpoint.release();
						console.log(error);
						return callback(error);
					}
                    
                    console.info('6. Creating composite');
                    pipeline.create('Composite', function (error, compositeHub) {
                        if (error) {
                            pipeline.release();
                            return callback(error);
                        }
                        
                        //room.composite = _compositeHub;
                        
                        console.info('7. Creating sender hub');
                        compositeHub.createHubPort(function (error, callerHubport) {
                            if (error) {
                                pipeline.release();
                                return callback(error);
                            } 
                            
                            //sender.hubport = _callerHubport;
                            
                            console.info('8. Creating receiver hub');
                            compositeHub.createHubPort(function (error, calleeHubport) {
                                if (error) {
                                    pipeline.release();
                                    return callback(error);
                                }
                                
                                //receiver.hubport = _calleeHubport;
                                
                                console.info('9. Connecting callerWebRtcEndpoint to callerHubport');
                                sender.webRtcEndpoint.connect(callerHubport, function (error) {
                                    if (error) {
                                        pipeline.release();
                                        return callback(error);
                                    }
                                    
                                    console.info('10. Connecting calleeWebRtcEndpoint to calleeHubport');
                                    receiver.webRtcEndpoint.connect(calleeHubport, function (error) {
                                        if (error) {
                                            pipeline.release();
                                            return callback(error);
                                        }
                                        
                                        //Create RecorderEndpoint
                                        //var ts = Math.floor(new Date().getTime() / 1000);
                                        //TODO Change absolut path to relative path
                                        //uri = videos_path + 'call_' + ts + '.webm';
                                        //var options = {
                                        //    uri: uri,
                                        //    useEncodedMedia: false
                                        //};
                                        console.info('11. Creating Call RecorderEndpoint');
                                        
                                        getRecorder(room, function(error, callRecorderEndpoint) {
                                            if (error) {
                                                stopCall(room);
                                                return callback(error);
                                            }
                                        
                                        /*pipeline.create('RecorderEndpoint', {uri: uri}, function (error, recorder) {
                                            if (error) {
                                                return callback(error);
                                            }*/
                                            
                                            console.info('12. Connecting callerHubport to callRecorderEndpoint');
                                            callerHubport.connect(callRecorderEndpoint, function (error) {
                                                if (error) {
                                                    console.error(error);
                                                    return callback(error);
                                                }

                                                callRecorderEndpoint.record(function (error) {
                                                    if (error) {
                                                        console.error(error);
                                                        return callback(error);
                                                    }
                                                    recording = true;
                                                    console.log("--> Recording call..." + recording);
                                                });
                                            });
                                        }); 
                                    });            
                                });            
                            });
                        });
                    });
				});
				return callback(null, sdpAnswer);
			});
		});
	});
}

function onIceCandidate(room, sessionId, _candidate) {
	var candidate = kurento.register.complexTypes.IceCandidate(_candidate);

	console.log('onIceCandidate called');
	var receiver = room.receivers[sessionId];
	if (!receiver) {
		return callback('Error getting Receiver');
	}
	console.log('onIceCandidate receiver');//, receiver);

	if (receiver.webRtcEndpoint) {
		console.info('Adding candidate');
		receiver.webRtcEndpoint.addIceCandidate(candidate);
	} else {
		console.info('Queueing candidate');
		receiver.candidateQueueVideo.push(candidate);
	}
}

function stopCall(room) {
  console.log("Starting stopCall method...");
    
	if (!room) {
		console.error("No room found.");
		return;
	}
    
    if (recording){
        /*if (room.recorder !== null) {
            console.log('Retrieving existent recorder.');
            room.recorder.stop(function(error){
                console.info("Stoping recording...");
                if(error) console.log(error);
                //room.pipeline.release();
                //room.sender.webRtcEndpoint.release();
                if (room.pipeline) {
                    room.pipeline.release();
                    console.info("Pipeline released...");
                }
                if (room.sender && room.sender.webRtcEndpoint) {
                    room.sender.webRtcEndpoint.release();
                    room.sender.webRtcEndpoint = null;
                    console.info("webRtcEndpoint released...");
                }  
            });
            recording = false;
        }else{
            console.log('No existing recorder object to be stopped.');
        }*/
        getRecorder(room, function(error, recorder) {
            if (error) {
                return callback(error);
            }
            recorder.stop(function(error){
                console.info("Stoping recording...");
                if(error) console.log(error);
                //room.pipeline.release();
                //room.sender.webRtcEndpoint.release();
                if (room.pipeline) {
                    room.pipeline.release();
                    console.info("Pipeline released...");
                }
                if (room.sender && room.sender.webRtcEndpoint) {
                    room.sender.webRtcEndpoint.release();
                    room.sender.webRtcEndpoint = null;
                    console.info("webRtcEndpoint released...");
                }  
            });
            recording = false;
        });
    }else{
        console.info("Stoping call...");
        //room.pipeline.release();
        //room.sender.webRtcEndpoint.release();
        if (room.pipeline) {
            room.pipeline.release();
            console.info("Pipeline released...");
        }
        if (room.sender && room.sender.webRtcEndpoint) {
            room.sender.webRtcEndpoint.release();
            room.sender.webRtcEndpoint = null;
            console.info("webRtcEndpoint released...");
        }        
    }
    
	// room.sender = null;
	var index = rooms.indexOf(room);
	if (index > -1) {
		rooms.splice(index, 1);
	}
  //TODO: release all receivers?
};

// messaging
function sendNotification() {
    console.log ("Sending notification...");
    /*agSender.Sender(msg_settings).send(message, options).on("success", function( response) {
        console.log("success called", response);
    });*/
    agSender.Sender(msg_settings).send(message, options, function(err, response) {
        if(!err) {
            console.log( "Notification: success called", response );
            return;
        }else{
            console.log( "Notification: unsucessful call", response );
            return;
        }
    });
}

app.use(express.static(path.join(__dirname, 'static')));