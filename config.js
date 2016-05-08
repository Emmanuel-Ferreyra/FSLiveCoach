var config = {}

config.port = '8080';
config.as_uri = "http://localhost:8080/";       //your kurento media connector (KMC) known also as application server (this server!)
config.ws_uri = "ws://localhost:8888/kurento";  //your kurento media server (KMS)
config.outputBitrate = 3000000;
config.appRTCUrl = '52.19.221.103:8080';       //the url of this server, this is where appRTC connects to
//leave uris empty to not use turn
config.turn = {
	"username": "<username>",
	"password": "<password>",
	"uris": [
		"turn:numb.viagenie.ca:3478",
		"turn:numb.viagenie.ca:3478?transport=udp",
		"turn:numb.viagenie.ca:3478?transport=tcp"
	]
};

module.exports = config;
