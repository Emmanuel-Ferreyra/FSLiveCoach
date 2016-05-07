/*
 * (C) Copyright 2016.  All rights reserved.
 * 
 */

function Sender(settings) {
	settings = settings ? settings : {};
	this.sessionId = settings.sessionId ? settings.sessionId : null;
	this.clientId = settings.clientId ? settings.clientId : null;
	this.websocket = settings.websocket ? settings.websocket : null;
	this.endpoint = settings.endpoint ? settings.endpoint : null;
	this.candidateQueue = [];
	// this.receivers = [];
}

Sender.prototype.getPipeline = function() {
	return this.pipeline;
};

module.exports = Sender;
