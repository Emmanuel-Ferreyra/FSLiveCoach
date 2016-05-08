//var ws = new WebSocket('wss://' + location.host + '/ws');
var ws = new WebSocket('ws://' + location.host + '/ws');
var videoInput;
var videoOutput;
var roomNameInput;
var webRtcPeer;
var host;

var registerName = null;
const NOT_REGISTERED = 0;
const REGISTERING = 1;
const REGISTERED = 2;
var registerState = null

function setRegisterState(nextState) {
	switch (nextState) {
	case NOT_REGISTERED:
		$('#register').attr('disabled', false);
		$('#call').attr('disabled', true);
		$('#terminate').attr('disabled', true);
		break;

	case REGISTERING:
		$('#register').attr('disabled', true);
		break;

	case REGISTERED:
		$('#register').attr('disabled', true);
		setCallState(NO_CALL);
		break;

	default:
		return;
	}
	registerState = nextState;
}

const NO_CALL = 0;
const PROCESSING_CALL = 1;
const IN_CALL = 2;
var callState = null

function setCallState(nextState) {
	switch (nextState) {
	case NO_CALL:
		$('#call').attr('disabled', false);
		$('#terminate').attr('disabled', true);
		break;

	case PROCESSING_CALL:
		$('#call').attr('disabled', true);
		$('#terminate').attr('disabled', true);
		break;
	case IN_CALL:
		$('#call').attr('disabled', true);
		$('#terminate').attr('disabled', false);
		break;
	default:
		return;
	}
	callState = nextState;
}

const I_CAN_START = 0;
const I_CAN_STOP = 1;
const I_AM_STARTING = 2;
var state = null;

function setState(nextState) {
	switch (nextState) {
		case I_CAN_START:
			$('#start').attr('disabled', false);
			$('#stop').attr('disabled', true);
			break;
		case I_CAN_STOP:
			$('#start').attr('disabled', true);
			$('#stop').attr('disabled', false);
			break;
		case I_AM_STARTING:
			$('#start').attr('disabled', true);
			$('#stop').attr('disabled', true);
			break;
		default:
			onError('Unknown state ' + nextState);
			return;
	}
	state = nextState;
}

window.onload = function() {
	host = location.protocol;
	setState(I_CAN_START);    
	setRegisterState(NOT_REGISTERED);
	var drag = new Draggabilly(document.getElementById('videoSmall'));
	videoInput = document.getElementById('videoInput');
	videoOutput = document.getElementById('videoOutput');
	//document.getElementById('name').focus();
	document.getElementById('roomName').focus();
    
	document.getElementById('register').addEventListener('click', function() {
		register();
	});
	document.getElementById('call').addEventListener('click', function() {
		call();
	});
	document.getElementById('terminate').addEventListener('click', function() {
		stop();
	});
	document.getElementById('start').addEventListener('click', function() {
		startWebRtc();
	});
	document.getElementById('stop').addEventListener('click', function() {
		stop();
	});    
    
	roomNameInput = $("input[name='roomName']");
}

window.onbeforeunload = function() {
	ws.close();
}

ws.onmessage = function(message) {
	var parsedMessage = JSON.parse(message.data);
	console.info('Received message: ' + message.data);

	switch (parsedMessage.id) {          
		case 'startResponse':
            //this is the only one from the original example
			startResponse(parsedMessage);
			break;
        case 'registerResponse':
            resgisterResponse(parsedMessage);
            break;
        case 'callResponse':
            callResponse(parsedMessage);
            break;
        case 'incomingCall':
            incomingCall(parsedMessage);
            break;
        case 'startCommunication':
            startCommunication(parsedMessage);
            break;
        case 'stopCommunication':
            console.info("Communication ended by remote peer");
            stop(true);
            break;            
		case 'iceCandidate':
			console.log('Remote IceCandidate');
			webRtcPeer.addIceCandidate(parsedMessage.candidate)
			break;            
		case 'error':
			onError('Error message from server: ' + parsedMessage.message);
			break;
        default:
			onError('Unrecognized message', parsedMessage);
	}
}

function startResponse(message) {
	setState(I_CAN_STOP);
	console.log('SDP answer received from server. Processing ...');
	webRtcPeer.processAnswer(message.sdpAnswer);
}

function resgisterResponse(message) {
	if (message.response == 'accepted') {
		setRegisterState(REGISTERED);
	} else {
		setRegisterState(NOT_REGISTERED);
		var errorMessage = message.message ? message.message
				: 'Unknown reason for register rejection.';
		console.log(errorMessage);
		alert('Error registering user. See console for further information.');
	}
}

function callResponse(message) {
	if (message.response != 'accepted') {
		console.info('Call not accepted by peer. Closing call');
		var errorMessage = message.message ? message.message
				: 'Unknown reason for call rejection.';
		console.log(errorMessage);
		stop(true);
	} else {
		setCallState(IN_CALL);
		webRtcPeer.processAnswer(message.sdpAnswer);
	}
}

function startCommunication(message) {
	setCallState(IN_CALL);
	webRtcPeer.processAnswer(message.sdpAnswer);
}

function incomingCall(message) {
	// If busy just reject without disturbing user
	if (callState != NO_CALL) {
		var response = {
			id : 'incomingCallResponse',
			from : message.from,
			callResponse : 'reject',
			message : 'busy'

		};
		return sendMessage(response);
	}

	setCallState(PROCESSING_CALL);
	if (confirm('User ' + message.from
			+ ' is calling you. Do you accept the call?')) {
		showSpinner(videoInput, videoOutput);

		var options = {
			localVideo : videoInput,
			remoteVideo : videoOutput,
			onicecandidate : onIceCandidate
		}

		webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options,
				function(error) {
					if (error) {
						console.error(error);
						setCallState(NO_CALL);
					}

					this.generateOffer(function(error, offerSdp) {
						if (error) {
							console.error(error);
							setCallState(NO_CALL);
						}
						var response = {
							id : 'incomingCallResponse',
							from : message.from,
							callResponse : 'accept',
							sdpOffer : offerSdp
						};
						sendMessage(response);
					});
				});

	} else {
		var response = {
			id : 'incomingCallResponse',
			from : message.from,
			callResponse : 'reject',
			message : 'user declined'
		};
		sendMessage(response);
		stop(true);
	}
}

function register() {
	var name = document.getElementById('name').value;
	if (name == '') {
		window.alert("You must insert your user name");
		return;
	}

	setRegisterState(REGISTERING);

	var message = {
		id : 'register',
		name : name
	};
	sendMessage(message);
	document.getElementById('peer').focus();
}

function call() {
	if (document.getElementById('peer').value == '') {
		window.alert("You must specify the peer name");
		return;
	}

	setCallState(PROCESSING_CALL);

	showSpinner(videoInput, videoOutput);

	var options = {
		localVideo : videoInput,
		remoteVideo : videoOutput,
		onicecandidate : onIceCandidate
	}

	webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options, function(
			error) {
		if (error) {
			console.error(error);
			setCallState(NO_CALL);
		}

		this.generateOffer(function(error, offerSdp) {
			if (error) {
				console.error(error);
				setCallState(NO_CALL);
			}
			var message = {
				id : 'call',
				from : document.getElementById('name').value,
				to : document.getElementById('peer').value,
				sdpOffer : offerSdp
			};
			sendMessage(message);
		});
	});
}

function stop(message) {
	console.log('Stopping video call ...');
    setCallState(NO_CALL);
	setState(I_CAN_START);
	if (webRtcPeer) {
		webRtcPeer.dispose();
		webRtcPeer = null;

		if (!message) {
			var message = {
				id : 'stop',
                cmd : 'stop',
                roomName: getRoomname()                
			}
			sendMessage(message);
		}
	}
	hideSpinner(videoInput, videoOutput);
}

function sendMessage(message) {
	var jsonMessage = JSON.stringify(message);
	console.log('Senging message: ' + jsonMessage);
	ws.send(jsonMessage);
}

function onIceCandidate(candidate) {
	console.log('Local candidate' + JSON.stringify(candidate));

	var message = {
		cmd: 'onIceCandidate',
		roomName: getRoomname(),
		candidate: candidate
	};
	sendMessage(message);
}

function showSpinner() {
	for (var i = 0; i < arguments.length; i++) {
		arguments[i].poster = './img/transparent-1px.png';
		arguments[i].style.background = 'center transparent url("./img/spinner.gif") no-repeat';
	}
}

function hideSpinner() {
	for (var i = 0; i < arguments.length; i++) {
		arguments[i].src = '';
		arguments[i].poster = './img/webrtc.png';
		arguments[i].style.background = '';
	}
}

function startWebRtc() {
	console.log('Starting WebRtc ...');

	setState(I_AM_STARTING);
	showSpinner(videoOutput);

	var options = {
		localVideo: videoInput,
		remoteVideo: videoOutput,
		onicecandidate : onIceCandidate
	}

	webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options, function(error) {
			if(error) return onError(error);
			this.generateOffer(onWebRtcOffer);
	});
}

function onWebRtcOffer(error, offerSdp) {
	if(error) return onError(error);

	console.info('onWebRtcOffer Invoking SDP offer callback function ' + location.host);
	console.log(roomNameInput, roomNameInput.val());
	var message = {
		cmd : 'startWebRtc',
		roomName: getRoomname(),
		sdpOffer : offerSdp
	}
	sendMessage(message);
}

function getRoomname() {
	var roomName = roomNameInput.val();
	return roomName;
}

function onError(error) {
    if (state == I_AM_STARTING) {
        setState(I_CAN_START);
    }
    
    $('#errorMsg').text(error);
	console.error(error);
}
