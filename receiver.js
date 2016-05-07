/*
 * (C) Copyright 2016.  All rights reserved.
 * 
 */

function Receiver(settings) {
	settings = settings ? settings : {};
	this.sessionId = settings.sessionId ? settings.sessionId : null;
	this.websocket = settings.websocket ? settings.websocket : null;
	// this.pipeline = null;
	this.videoEndpoint = settings.videoEndpoint ? settings.videoEndpoint : null;
	this.audioEndpoint = settings.audioEndpoint ? settings.audioEndpoint : null;;
	this.candidateQueueVideo = [];
	this.candidateQueueAudio = [];
}

module.exports = Receiver;
