var ws = new WebSocket('ws://' + location.host + '/ws');
var videoInput;
var videoOutput;
var roomNameInput;
var webRtcPeer;
var host;
var state = null;

const I_CAN_START = 0;
const I_CAN_STOP = 1;
const I_AM_STARTING = 2;

window.onload = function() {
	// console = new Console();
	console.log('Page loaded ...');
	videoInput = document.getElementById('videoInput');
	videoOutput = document.getElementById('videoOutput');

	roomNameInput = $("input[name='roomName']");

	// $('#startAudio').attr('onclick', 'startAudio()');
	// $('#getStats').attr('onclick', 'getStats()');
	// $('#startSendWebRTC').attr('onclick', 'startSendWebRTC()');
	// $('#stopSendWebRTC').attr('onclick', 'stopSendWebRTC()');
	host = location.protocol;
	setState(I_CAN_START);
}

window.onbeforeunload = function() {
	ws.close();
}

ws.onmessage = function(message) {
	var parsedMessage = JSON.parse(message.data);
	console.info('Received message: ' + message.data);

	switch (parsedMessage.id) {
		case 'startResponse':
			startResponse(parsedMessage);
			break;
		case 'startAudioResponse':
			startAudioResponse(parsedMessage);
			break;
		case 'startSendWebrtcResponse':
			startSendWebrtcResponse(parsedMessage);
			break;
		case 'rtpAnswer':
			console.log(parsedMessage);
			break;
		case 'error':
			if (state == I_AM_STARTING) {
				setState(I_CAN_START);
			}
			onError('Error message from server: ' + parsedMessage.message);
			break;
		case 'iceCandidate':
			console.log('Remote Ice');
			webRtcPeer.addIceCandidate(parsedMessage.candidate)
			break;
		case 'iceCandidateAudio':
			console.log('Remote Ice');
			webRtcPeerSend.addIceCandidate(parsedMessage.candidate)
			break;
		case 'iceCandidateSendWebRtc':
			console.log('iceCandidateSendWebRtc Remote Ice');
			webRtcPeerSendWebRtc.addIceCandidate(parsedMessage.candidate)
			break;
		case 'getStats':
			console.log('getStats message received');
			console.log(parsedMessage);
			break;
		case 'sendStatus':
			console.log(parsedMessage);
			if (parsedMessage.sending) {
				$('#sendStatus').removeClass("label-warning");
				$('#sendStatus').addClass("label-success");
				$('#sendStatus').text('Sending');
			} else {
				$('#sendStatus').removeClass("label-success");
				$('#sendStatus').addClass("label-warning");
				$('#sendStatus').text('Not Sending');
			}
			break;
		default:
			if (state == I_AM_STARTING) {
				setState(I_CAN_START);
			}
			onError('Unrecognized message', parsedMessage);
	}
}

function setState(nextState) {
	switch (nextState) {
		case I_CAN_START:
			$('#start').attr('disabled', false);
			$('#start').attr('onclick', 'startWebRtc()');
			$('#stop').attr('disabled', true);
			$('#stop').removeAttr('onclick');
			break;

		case I_CAN_STOP:
			$('#start').attr('disabled', true);
			$('#stop').attr('disabled', false);
			$('#stop').attr('onclick', 'stop()');
			break;

		case I_AM_STARTING:
			$('#start').attr('disabled', true);
			$('#start').removeAttr('onclick');
			$('#stop').attr('disabled', true);
			$('#stop').removeAttr('onclick');
			break;

		default:
			onError('Unknown state ' + nextState);
			return;
	}
	state = nextState;
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

function startResponse(message) {
	setState(I_CAN_STOP);
	console.log('SDP answer received from server. Processing ...');
	webRtcPeer.processAnswer(message.sdpAnswer);
}

function stop() {
	console.log('Stopping video call ...');
	setState(I_CAN_START);
	if (webRtcPeer) {
		webRtcPeer.dispose();
		webRtcPeer = null;

		var message = {
			cmd : 'stop',
			roomName: getRoomname()
		}
		sendMessage(message);
	}
	hideSpinner(videoInput, videoOutput);
}

function getRoomname() {
	var roomName = roomNameInput.val();
	return roomName;
}

function onError(error) {
	console.error(error);
}
