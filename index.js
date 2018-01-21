const Discord = require("discord.js");
const client = new Discord.Client();
const ytdl = require('ytdl-core');
const fs = require('fs');
const express = require('express')
const bodyParser = require('body-parser')
const http = require('http')
const https = require('https')
const WebSocket = require('ws');
const simpleNodeLogger = require('simple-node-logger'); // https://www.npmjs.com/package/simple-node-logger
const config = require('./config').newConfig('config/config.json');
const feeder = require('./feeder');

// setup config
config.load();
// create a file only file logger
const logger = simpleNodeLogger.createSimpleLogger('project.log');

const API_KEY = config.get('googleApiKey');
const PLAY_QUEUE = [];
const STREAM_OPTIONS = { seek: 0, volume: .1 };


let nowPlaying = {title: null, video_url: null, time_total: null, thumbnail_url: '#'};
let voiceConn = null;
let dispatcher = null;
let lastID = 0;
let playTimeInterval = null;


client.on('ready', () => {
  logger.info(`Logged in as ${client.user.tag}!`);
});

client.on('message', msg => {
  if (msg.author.id === client.user.id) return;
    let msgContent = msg.content.split(" ")
    let cmd = msgContent[0].toLowerCase();
  if (cmd === 'ping') {
    msg.reply('Pong!');
  } else if (cmd === '!music' || cmd === '!join') {
      if (msg.member.voiceChannel) {
          msg.member.voiceChannel.join()
          .then(connection => { 
            logger.info('Connected!'); 
            voiceConn = connection; 
            voiceConn.on('error', (err) => logger.info(err));
            voiceConn.on('disconnect', (obj) => {if (playTimeInterval) {client.clearInterval(playTimeInterval)}});
            playTimeInterval = client.setInterval(updatePlayTime, 1000);
            
          })
          .catch(logger.info);
      }
      else {
          msg.reply('You have to be in a voice channel silly.');
      }
  } else if (cmd === '!queue') {
      queue(msgContent[1].replace(/\`/g, ''), msg)
      .catch((err) => logger.info( `Error Getting YT Info: ${err}`))
  } else if (cmd === '!play') {
      next();
  } else if (cmd === '!leave') {
      if (voiceConn && msg.member.voiceChannel) {
          if(voiceConn.channel.id == msg.member.voiceChannel.id) {
              voiceConn.channel.leave();
              voiceConn = null;
              logger.info('Leaving channel at user command.')
          } else {
              msg.reply(`We aren't in the same channel, I can't leave if I'm not there...`)
          }
      } else {
          msg.reply(`One of us isn't in a voice channel...`);
      }
  } else if (msg.content.indexOf('ayy') >= 0 || msg.content.indexOf('Ayy') >= 0) {
    // process ayy lmaos
    var lmaos = ['ayy lmao! :alien:', 'Respect the Ayylien! :alien:', 'remember the ayylmao! :alien: :face_with_cowboy_hat:', "https://goo.gl/PtZcNG", "https://goo.gl/y4sxox", "https://goo.gl/f6zU8U", "https://goo.gl/WRuXn3"];
    var lmao = lmaos[Math.floor(Math.random()*lmaos.length)];
    msg.reply(lmao);
  }
});

function getPlaylist(playlistID, msg, nextPageToken) {
  return new Promise(
    function(resolve, reject) {
      let API_PATH = `/youtube/v3/playlistItems?part=id%2C+snippet&maxResults=50&playlistId=${playlistID}&key=${API_KEY}`;
      if (nextPageToken) {
        API_PATH = `${API_PATH}&pageToken=${nextPageToken}`;
      }
      const options = {
        hostname: 'www.googleapis.com',
        port: 443,
        path: API_PATH,
        method: 'GET'
      };
    
      const req = https.request(options, (res) => {
        var body = '';
        res.on('data', function(d) {
          body += d;
        });
        res.on('end', function() {
          var data = JSON.parse(body);
          if (!data.items) { reject('undefined playlist.')}
          //data.items.forEach((item) => { addToPlaylist(item.snippet.title, item.snippet.resourceId.videoId, item.snippet.thumbnails.default.url);} );
          data.items.forEach((item) => { getVideo(item.snippet.resourceId.videoId);} );
          if (data.nextPageToken) {
            getPlaylist(playlistID, msg, data.nextPageToken).then(resolve).catch(reject);
          } else {
            resolve();
          }
        });
      });
    
      req.on('error', (e) => {
        console.error(e);
        reject();
      });
      req.end();
    }
  );
}
function getVideo(url, msg) {
    return ytdl.getInfo(url, [])
    .then((info) => {
      if (!info) {
        logger.info( `Error Getting YT Info: ${info}`);
      } else {
        addToPlaylist(info.title, info.video_url, info.length_seconds, info.thumbnail_url);
        if (msg) {
          msg.reply(`Queuing "${info.title}"(${info.length_seconds}s) from \`\`${info.video_url}\`\``)
        }
      }
    })
}

function queue(url, msg) {
  let songUrl = url;
  if (/\/playlist\?list=/i.test(url)) {
    // playlist is 18 char's
    let playlistID = url.match(/(?:list=)[\w-]+/i)[0].replace('list=', '');
    logger.info(`Trying to Queue Playlist: ${playlistID}`);
    return getPlaylist(playlistID, msg);
  } else {
    logger.info(`Trying to Queue url: ${songUrl}`)
    return getVideo(url, msg);
  }

}

function addToPlaylist(title, video_url, length_seconds, thumbnail_url) {
  let url = {id: getNextID(), title: title, video_url: video_url, time_total: length_seconds, thumbnail_url: thumbnail_url}
  PLAY_QUEUE.push(url)
  updateClients({action: 'QUEUE', data: [url]});
  logger.info(`Queuing "${title}" from \`\`${video_url}\`\``);
}

function isDispatcherActive() {
  return dispatcher && !dispatcher.destroyed;
}

function pause() {
  if (!isPaused() && isDispatcherActive()) {
    dispatcher.pause();
    updatePlayStatus();
  }
}

function play() {
  if (isPaused() && isDispatcherActive()) {
    dispatcher.resume();
    updatePlayStatus();
  } else if(!isDispatcherActive()) {
    next();
  }
}

function isPaused() {
  return isDispatcherActive() ? dispatcher.paused : true;
}

function updatePlayStatus() {
  updateClients({action: 'PLAY_STATUS', isPlaying: !isPaused()});
}

function updatePlayTime() {
  if (isDispatcherActive()) {
    updateClients({action: 'PLAY_TIME', time_played: (dispatcher.time/1000), time_total: nowPlaying.time_total });
  }
}

function delayNext()  {
  /* 
  * This is a shitty workaround for a bug in discord.js  
  * https://github.com/hydrabolt/discord.js/issues/1387 
  */
  setTimeout(next, 200)
}

function next(){
    logger.info('trying to play next song.');
    if (dispatcher && !dispatcher.destroyed) {
        logger.info('destroying dispatcher.');
        if (PLAY_QUEUE.length == 0) {
          nowPlaying = {title: null, video_url: null, thumbnail_url: '#'};
          updateClients({action: 'NOW_PLAYING', data: [nowPlaying]});
          updatePlayStatus();
        }
        dispatcher.end('user said play next.')
    } else {
        logger.info('checking queue...');
        if (!voiceConn) {
          logger.info(`No voice connection`)
        } else if (PLAY_QUEUE.length > 0) {
            nowPlaying = PLAY_QUEUE.shift();
            updateClients({action: 'UNQUEUE', data: [nowPlaying]});
            updateClients({action: 'NOW_PLAYING', data: [nowPlaying]});
            logger.info(`streaming next song: ${nowPlaying.title}. ${PLAY_QUEUE.length} remaining in queue.`);
            updateClients({action: 'LOADING_STREAM', loading: true });
            //dlSong(songUrl);
            const stream = ytdl(nowPlaying.video_url, { filter : 'audioonly' });
            dispatcher = voiceConn.playStream(stream, STREAM_OPTIONS);
            dispatcher.on('start', () => {updateClients({action: 'LOADING_STREAM', loading: false });});
            dispatcher.on('end', (reason) => {logger.info(`Stream ending: ${reason}`); nowPlaying = {title: null, video_url: null, time_total: null, thumbnail_url: '#'}; delayNext();});
            dispatcher.on('error', (reason) => {logger.info(`Stream Error: ${reason}`);});
            updatePlayStatus();
            // set 'playing' to the song or nothing if no song
            client.user.setGame(nowPlaying.title ? nowPlaying.title : '');
        } else {
          logger.info(`Empty Queue, stopping.`);
          updatePlayStatus();
          client.user.setGame('');
        }
    }
}

function getNextID() {
  if (lastID < Number.MAX_VALUE) {
    lastID++;
  } else {
    lastID = 1;
  }
  return lastID;
}

function unqueue(id) {
  return new Promise( /* executor */ function(resolve, reject) {
    let index = PLAY_QUEUE.findIndex((element) => { return element.id == id; });
    if (index >= 0) {
      let removed = PLAY_QUEUE.splice(index, 1);
      updateClients({action: 'UNQUEUE', data: removed});
      resolve();
    } else {
      logger.info(`not finding removal id of ${id}`)
      reject();
    }
  } );
}

/* 
 * setup web sockets
 */
const wss = new WebSocket.Server({ port: config.get('appPort') });

function heartbeat() {
  this.isAlive = true;
}

wss.on('connection', function connection(ws) {
  ws.isAlive = true;
  logger.info('client connected to WebSocket.');
  updateClients({action: 'INIT_QUEUE', data: PLAY_QUEUE});
  updateClients({action: 'NOW_PLAYING', data: [nowPlaying]});
  updateClients({action: 'INIT_CLIENT', name: client.user.username});
  updatePlayStatus();
  ws.on('pong', heartbeat);
});

const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping('', false, true);
  });
}, 30000);

function updateClients(jsonObj) {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) return ws.terminate();
    ws.send(JSON.stringify(jsonObj));
    
  });
}

// setup express server for web page
const app = express()
app.set('port', (config.get('httpPort') || 8080))
// parse application/json
app.use(bodyParser.json());
// statically serve css/js/images
app.use(express.static('www'));
// Index route
app.get('/', function(req, res) {
	res.sendFile(__dirname + '/index.html')
})
app.post('/next', function(req, res) {
	next();
	res.sendStatus(200);
})
app.post('/play', function(req, res) {
	play();
	res.sendStatus(200);
})
app.post('/pause', function(req, res) {
	pause();
	res.sendStatus(200);
})
app.post('/update', function(req, res) {
	res.json({queue:PLAY_QUEUE, nowPlaying:nowPlaying})
})
app.post('/appport', function(req, res) {
	res.json({appPort: config.get('appPort')})
})
app.post('/queue', function(req, res) {
	logger.info(req.body);
	queue(req.body.url)
	  .then(() => {res.sendStatus(200)})
	  .catch(() => {res.sendStatus(304)});

})
app.post('/unqueue', function(req, res) {
	logger.info(req.body);
	unqueue(req.body.id)
	  .then(() => {res.sendStatus(200)})
	  .catch(() => {res.sendStatus(304)});
})

/* Handle ctrl+c to manage cleanup */
process.on('SIGINT', function() {
    logger.info('Caught interrupt signal');
    /* leave voice channels */
    if (voiceConn) {
      voiceConn.channel.leave();
      voiceConn = null;
    }
    /* destroy discord client */
    client.destroy();
    /* finally exit the process */
    process.exit();
});

// Spin up the server
const server = http
	.createServer(app) // set sslOptions and set express as app server
	.listen(app.get('port'), function() {
		logger.info('running on port', app.get('port'))
	});
// login to discord
client.login(config.get('token'));
// start rss feed
feeder.startRSS(config, client);

// queue a few things for the fuck of it.
queue('https://www.youtube.com/watch?v=XxGmgmelZV0', null)
queue('https://www.youtube.com/watch?v=fz7dttXLaOE', null)
