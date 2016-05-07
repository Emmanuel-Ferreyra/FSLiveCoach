/*
 * (C) Copyright 2016.  All rights reserved.
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
var config = require('./config');

var Sender = require('./sender');
var Receiver = require('./receiver');
var Room = require('./room');


var kurentoClient = null;
var rooms = [];
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

var sessionHandler = session({
	secret: 'none',
	rolling: true,
	resave: true,
	saveUninitialized: true
});

app.use(sessionHandler);
app.use(bodyParser.json({
	type: 'text'
}));
app.use(cookieParser());

/*
 * Server startup
 */

// var as_uri = config.as_uri;
var serverUrl = config.appRTC_url;
var ws_uri = config.ws_uri;
var port = config.port;
var server = app.listen(port, function() {
    console.info('---------------------------------------------');
    console.info('FS Live Coach started');
    console.info('Open http://' + serverUrl + ':' + port + ' with a WebRTC capable browser');
    console.info('---------------------------------------------');
});

app.use(function(req, res, next) {
	console.info(req.protocol, req.method, req.path, req.get('Content-Type'));
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
		console.info('Connection received with sessionId ' + sessionId);
	});

	ws.on('error', function(error) {
		console.error('Connection ' + sessionId + ' error: ', error);
		getRoomBySession(sessionId, function(err, room) {
			stopReceive(room);
			stopSend(room);
		});
	});

	ws.on('close', function() {
		console.info('Connection ' + sessionId + ' closed');
		getRoomBySession(sessionId, function(err, room) {
			stopReceive(room);
			stopSend(room);
		});
	});

	ws.on('message', function(_message) {
		var message = JSON.parse(_message);
		console.info('Connection ' + sessionId + ' received message ', message);
		var clientId = message.clientid ? message.clientid : "empty";
		var roomname = message.roomid ? message.roomid : "emptyID";

		switch (message.cmd) {
			case 'register':
				console.info('Received message: register');
				getRoom(roomname, function(error, room) {
					if (error) {
						console.error('Error: ' + error);
						return ws.send(JSON.stringify({
							msg: {},
							error: err
						}));
					}
					if (!room) {
						console.error('Error: Room not found');
						ws.send(JSON.stringify({
							msg: {},
							error: 'Room not found'
						}));
					}
					if (!room.sender) {
                        console.info('Different sender. Creating new sender - clientId:' + clientId);
						room.sender = new Sender({
							sessionId: sessionId,
							clientId: clientId,
							websocket: ws
						});
					} else {
                        console.info('Existing sender - clientId:' + clientId);
						room.sender.websocket = ws;
						room.sender.clientId = clientId;
						room.sender.sessionId = sessionId;
					}
					//TODO: what if already offered?
					if (room.senderSdpOffer) {
						console.info('TODO: got the sdpOffer first');
					}
				});
				break;

			case 'startWebRtc':
				console.info('Received message: startWebRtc');
				var sdpOffer = message.sdpOffer;
				var roomName = message.roomName;
				getRoom(roomName, function(error, room) {
					if (error) {
						console.error('Error: ' + error);
						return ws.send(JSON.stringify({
							msg: {},
							error: err
						}));
					}                    
					if (!room) {
                        console.error('Error: Room not found');
						return ws.send(JSON.stringify({
							id: 'error',
							message: 'Room not found'
						}));
					}
					startWebRtc(room, sessionId, ws, sdpOffer, function(error, sdpAnswer) {
						if (error) {
							console.error('Error: ' + error);
							return ws.send(JSON.stringify({
								id: 'error',
								message: error
							}));
						}
						console.info("startWebRtc response:", sdpAnswer);
						ws.send(JSON.stringify({
							id: 'startResponse',
							sdpAnswer: sdpAnswer
						}));
					});
				});
				break;

			case 'onIceCandidate':
				var roomName = message.roomName;
				getRoom(roomName, function(error, room) {
					if (error) {
						console.error('Error: ' + error);
						return ws.send(JSON.stringify({
							msg: {},
							error: err
						}));
					}                       
					if (!room) {
                        console.error('Error: Room not found');
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
				getRoom(roomName, function(error, room) {
					if (error) {
						console.error('Error: ' + error);
						return ws.send(JSON.stringify({
							msg: {},
							error: err
						}));
					}                      
					if (room) {
						stopReceive(room);
					}
				});
				break;

			default:
				console.info('something else called');
		}
	});
});

app.all('/join/:roomname', function(req, res) {
  console.info('join called', req.body);
  var roomName = req.params.roomname ? req.params.roomname : "empty";

	//create room
	getRoom(roomName, function(error, room) {
		if (error) {
			console.error('Error: ' + error);
			return res.json({
				"result": "ERROR"
			});
		}
		if (!room) {
            console.info('Room not found. Creating new room.');
			room = new Room({
				roomName: roomName
			});
			rooms.push(room);
		}

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
        console.info('Sending response...');
		res.json(response);
	});
});

app.all('/leave/:roomname/:clientId', function(req, res) {
  console.info('leave called', req.body);
  var roomName = req.params.roomname ? req.params.roomname : "empty";
  var clientId = req.params.clientId ? req.params.clientId : "emptyID";
	getRoom(roomName, function(error, room) {
		if (error) {
			console.error('Error: ' + error);
			return res.json({
				"result": "ERROR"
			});
		}        
		if (room) {
            console.info('Stop send.');
			stopSend(room);
		}
        console.info('todo leave');
		res.send('todo');
	});
});

app.all('/turn', function(req, res) {
  console.info('turn called', req.body);

  var response = config.turn;
  res.json(response);
});

app.all('/message/:roomname/:clientId', function(req, res) {
	console.info('message called', req.body.type);
	var roomName = req.params.roomname ? req.params.roomname : "empty";
	var clientId = req.params.clientId ? req.params.clientId : "emptyID";
	var message = req.body;
	getRoom(roomName, function(error, room) {
		if (error) {
            console.error('Error: ' + error);
			res.json({
				"result": "ERROR",
				"error": error
			});
		}
		if (!room) {
			//I dunno
            res.send('I dunno');
		}

		// console.info(message, roomName, id);
		switch (message.type) {
			case 'candidate':
				var sender = room.sender;
				console.info('candidate', message.candidate);
				var rewrittenCandidate = {
					candidate: message.candidate,
					sdpMid: 'sdparta_0',
					sdpMLineIndex: message.label
				};

				var candidate = kurento.register.complexTypes.IceCandidate(rewrittenCandidate);

				if (sender.webRtcEP) {
					console.info('appRTC Ice Candidate. Adding ICE candidate', candidate);
					sender.webRtcEP.addIceCandidate(candidate);
				} else {
					//TODO:
					console.info('appRTC Ice Candidate. Queueing ICE candidate', sender.candidateQueue);
					sender.candidateQueue.push(candidate);
				}
				break;
			case 'offer':
				if (room.sender && room.sender.websocket) {
					var sender = room.sender;
					console.info('offer. websocket is present');
					var onCandidate = function(event) {
						// console.info("onCandidate");
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
						console.error('started webrtc in POST', error);
						var sendSdpAnswer = {
							msg: {
								type: 'answer',
								sdp: sdpAnswer
							},
							error: ''
						};

						sender.websocket.send(JSON.stringify(sendSdpAnswer));
						// sendSendStatus();
					});
				} else {
					console.info('No websocket is present');
					room.senderSdpOffer = message.sdp;
				}
				break;
			default:
				console.info('default');
		}
		//just send success
		res.json({
			"result": "SUCCESS"
		});
	});
});

function getKurentoClient(callback) {
	if (kurentoClient !== null) {
		return callback(null, kurentoClient);
	}
	kurento(ws_uri, function(error, _kurentoClient) {
		if (error) {
			console.error("Could not find media server at address " + ws_uri);
			return callback("Could not find media server at address" + ws_uri + ". Exiting with error " + error);
		}

		kurentoClient = _kurentoClient;
		callback(null, kurentoClient);
	});
}

function getPipeline(room, callback) {
	if (!room) {
		return callback('No Room');
	}

	if (room.pipeline !== null) {
		console.info('saved pipeline');
		return callback(null, room.pipeline);
	}
	getKurentoClient(function(error, kurentoClient) {
		if (error) {
			return callback(error);
		}
		kurentoClient.create('MediaPipeline', function(error, _pipeline) {
			if (error) {
                console.error('Error: ' + error);
				return callback(error);
			}
			room.pipeline = _pipeline;
			return callback(null, room.pipeline);
		});
	});
};

function getRoom(roomName, callback) {
	console.info("Looking for room:", roomName);
	for (var i = 0; i < rooms.length; i++) {
		if (rooms[i].roomName == roomName) {
			return callback(null, rooms[i]);
		}
	}
	return callback(null, null);
};

function getRoomBySession(sessionId, callback) {
	console.info("Looking for room with session:", sessionId);
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
			sender.webRtcEP = _webRtcEndpoint;

			console.info("Read queue:", sender.candidateQueue);
			if (sender.candidateQueue) {
				while (sender.candidateQueue.length) {
					console.info("Adding candidate from queue.");
					var candidate = sender.candidateQueue.shift();
					sender.webRtcEP.addIceCandidate(candidate);
				}
			}

			sender.webRtcEP.processOffer(sdpOffer, function(error, sdpAnswer) {
				if (error) {
					sender.webRtcEP.release();
					return callback(error);
				}

				sender.webRtcEP.on('OnIceCandidate', function(event) {
					onCandidate(event);
				});

				sender.webRtcEP.gatherCandidates(function(error) {
					if (error) {
						stopReceive(sessionId);
						return callback(error);
					}
				});

				console.info("Sending aerogear message...");           
                sendNotification();
				console.info("sending sdp answer");
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
	if (!sender || !sender.webRtcEP) {
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
		receiver.webRtcEP = _webRtcEndpoint;

		if (receiver.candidateQueueVideo) {
			while (receiver.candidateQueueVideo.length) {
				console.info("Adding candidate from queue");
				var candidate = receiver.candidateQueueVideo.shift();
				receiver.webRtcEP.addIceCandidate(candidate);
			}
		}

		receiver.webRtcEP.processOffer(sdpOffer, function(error, sdpAnswer) {
			if (error) {
				receiver.webRtcEP.release();
				return callback(error);
			}
            console.info('4. Connecting receiver WebRtcEndpoint to sender WebRtcEndpoint');
			sender.webRtcEP.connect(receiver.webRtcEP, function(error) {
				if (error) {
					receiver.webRtcEP.release();
					console.info(error);
					return callback(error);
				}

				receiver.webRtcEP.on('OnIceCandidate', function(event) {
					var candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
					ws.send(JSON.stringify({
						id: 'iceCandidate',
						candidate: candidate
					}));
				});

				receiver.webRtcEP.gatherCandidates(function(error) {
					if (error) {
						stopReceive(sessionId);
						return callback(error);
					}
				});

                console.info('5. Connecting sender WebRtcEndpoint to receiver WebRtcEndpoint');
				receiver.webRtcEP.connect(sender.webRtcEP, function(error) {
					if (error) {
						receiver.webRtcEP.release();
						console.info(error);
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
                                sender.webRtcEP.connect(callerHubport, function (error) {
                                    if (error) {
                                        pipeline.release();
                                        return callback(error);
                                    }
                                    
                                    console.info('10. Connecting calleeWebRtcEndpoint to calleeHubport');
                                    receiver.webRtcEP.connect(calleeHubport, function (error) {
                                        if (error) {
                                            pipeline.release();
                                            return callback(error);
                                        }
                                        
                                        //Create RecorderEndpoint
                                        var ts = Math.floor(new Date().getTime() / 1000);
                                        //TODO Change absolut path to relative path
                                        uri = videos_path + 'call_' + ts + '.webm';
                                        var options = {
                                            uri: uri,
                                            useEncodedMedia: false
                                        };
                                        console.info('11. Creating Caller RecorderEndpoint. File to be recorded: ' + uri);

                                        pipeline.create('RecorderEndpoint', {uri: uri}, function (error, callRecorderEndpoint) {
                                            if (error) {
                                                return callback(error);
                                            }
                                            
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
                                                    console.info("--> Recording call...");
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

	console.info('onIceCandidate called');
	var receiver = room.receivers[sessionId];
	if (!receiver) {
		return callback('Error getting Receiver');
	}
	console.info('onIceCandidate receiver', receiver);

	if (receiver.webRtcEP) {
		console.info('Adding candidate');
		receiver.webRtcEP.addIceCandidate(candidate);
	} else {
		console.info('Queueing candidate');
		receiver.candidateQueueVideo.push(candidate);
	}
}

function stopSend(room) {
  console.info("stopSend");
	if (!room) {
		console.error("no room");
		return;
	}
	if (room.pipeline) {
		room.pipeline.release();
	}
	if (room.sender && room.sender.webRtcEP) {
		room.sender.webRtcEP.release();
		room.sender.webRtcEP = null;
	}
	// room.sender = null;
	var index = rooms.indexOf(room);
	if (index > -1) {
		rooms.splice(index, 1);
	}
  //TODO: release all receivers?
};

function stopReceive(room) {
	console.info('TODO: stopReceive', room);
	if (!room) {
		console.error("stopReceive no room");
		return;
	}
  // var receiver = receivers[sessionId];
  // if (receiver && receiver.webRtcEP) {
  //   receiver.webRtcEP.release();
  //   console.info("Released receiving webRtcEP");
  // }
  // if (receiver && receiver.audioEndpoint) {
  //   receiver.audioEndpoint.release();
  //   console.info("Released receiving audioEndpoint");
  // }
}

// messaging
function sendNotification() {
    console.info ("Sending notification...");
    /*agSender.Sender(msg_settings).send(message, options).on("success", function( response) {
        console.info("success called", response);
    });*/
    agSender.Sender(msg_settings).send(message, options, function(error, response) {
        if(!err) {
            console.info("App messaging - Notification: success called", response);
            return;
        }else{
            console.info("App messaging - Notification: unsucessful call", response);
            return;
        }
    });
}

app.use(express.static(path.join(__dirname, 'static')));