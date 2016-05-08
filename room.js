var Receiver = require('./receiver');

function Room(settings) {
	settings = settings ? settings : {};
	this.roomName = settings.roomName ? settings.roomName : null;
	this.sender = settings.sender ? settings.sender : null;
	this.receivers = settings.receivers ? settings.receivers : [];
	this.pipeline = settings.pipeline ? settings.pipeline : null;
	this.senderSdpOffer = settings.senderSdpOffer ? settings.senderSdpOffer : null;
}

Room.prototype.getOrCreateReceiver = function(settings) {
  if (this.receivers[settings.sessionId]) {
    return this.receivers[settings.sessionId];
  } else {
    var receiver = new Receiver(settings);
    this.receivers[settings.sessionId] = receiver;
    return receiver;
  }
}

module.exports = Room;
