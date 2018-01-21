var rowTemplate = '<tr><td class="table-left" data-label="Name">{title}</td><td class="table-mid" data-label="URL"><a href="{video_url}">Link</a></td><td class="table-right"><span class="close" onclick="unqueueSong({id})"></span></td></tr>'

var queue = [];
var webSocketPort = null;
let nowPlaying = {title: null, video_url: null, length: null, thumbnail_url: '#'}

function getStatusBar(timePlayed, timeTotal) {
  return `<progress class="col" value="${timePlayed}" max="${timeTotal}"></progress><p class="col" >${formatTime(Math.round(timePlayed))}/${formatTime(timeTotal)}</p>`;
}

function postCommand(command) {
  var oReq = new XMLHttpRequest();
  oReq.addEventListener("load", (evt) => {if (oReq.readyState == 4) {if (oReq.status == '200') {console.log(`'${command}' was successful`);} else {alert(`'${command}' failed`);}}});
  oReq.open("POST", "/"+command);
  oReq.send();
}

function getWebSocketPort() {
  var oReq = new XMLHttpRequest();
  oReq.addEventListener("load", 
    (evt) => {
      console.log(oReq.readyState);
      console.log(oReq.status);
      if (oReq.readyState == 4) {
        if (oReq.status == 200) {
          console.log('received app port');
          webSocketPort = JSON.parse(oReq.responseText).appPort;
          // start websocket
          openWebSocket();
        } else {
          alert(`'appport' POST failed`);
        }
      }
    });
  oReq.open("POST", "/appport", true);
  oReq.setRequestHeader("Content-type", "application/json");
  console.log('requesting app port');
  oReq.send();
}

function postQueue() {
  var oReq = new XMLHttpRequest();
  var youtubeUrl = document.getElementById("link").value;
  oReq.addEventListener("load", (evt) => {if (oReq.readyState == 4) {if (oReq.status == 200) {console.log(`'queueing' was successful`); document.getElementById("link").value = '';} else {alert(`'queueing' failed`);}}});
  oReq.open("POST", "/queue");
  oReq.setRequestHeader("Content-type", "application/json");
  oReq.send(JSON.stringify({"url": youtubeUrl}));
}

function unqueueSong(id) {
  var oReq = new XMLHttpRequest();
  oReq.addEventListener("load", () => {console.log(`Unqueue request complete: ${oReq.status}`)});
  oReq.open("POST", "unqueue", true);
  oReq.setRequestHeader("Content-type", "application/json");
  oReq.send(JSON.stringify({"id": id}));
}

function refreshQueue() {
  var node = document.getElementById("queue-table");
  while (node.hasChildNodes()) {
    node.removeChild(node.lastChild);
  }
  queue.forEach((element) => {addChildRow(element.id, element.title, element.video_url)});
}

function refreshNowPlaying() {
    document.getElementById("now-playing").innerText = nowPlaying.title;
    document.getElementById("now-playing").href = nowPlaying.video_url;
    document.getElementById("now-playing-thumb").src = nowPlaying.thumbnail_url;
}

function refreshPlayButton(isPlaying) {
    document.getElementById("button-play").value = isPlaying ? 'Pause' : 'Play';
    document.getElementById("button-play").onclick = isPlaying ? () => {postCommand('pause');} : () => {postCommand('play');};
}

function refreshStatusBar(timePlayed, timeTotal) {
  document.getElementById('statusContainer').innerHTML = getStatusBar(timePlayed, timeTotal);
}

function addChildRow(id, title, video_url) {
    var table = document.getElementById("queue-table");
    var newRow = document.createElement("tr");
    newRow.innerHTML = rowTemplate.replace('{title}', title).replace('{video_url}', video_url).replace('{id}', id);
    table.appendChild(newRow);
}

function formatTime(s) {
  return(s-(s%=60))/60+(9<s?':':':0')+s;
}

/* WebSocket*/
function openWebSocket() {
  var connection;
  connection = new WebSocket(`ws://somersdev.com:${webSocketPort}`);

  // When the connection is open, send some data to the server
  connection.onopen = function () {
    connection.send('ping'); // Send the message 'Ping' to the server
  };
  
  // Log errors
  connection.onerror = function (error) {
    console.log('WebSocket Error ' + error);
  };
  
  // try reconnecting on close
  connection.onclose = function (event) {
    console.log(`Socket closed. Attempting to retry WebSocket Connection. ${event.reason}`);
    setTimeout(openWebSocket, 10000);
  };
  
  // Log messages from the server
  connection.onmessage = function (e) {
    console.log('Server: ' + e.data);
    let data = JSON.parse(e.data);
    if (data.action == 'INIT_QUEUE') {
      queue = data.data;
      refreshQueue();
    } else if (data.action == 'QUEUE') {
      data.data.forEach((item)=> {queue.push(item);});
      refreshQueue();
    } else if (data.action == 'UNQUEUE') {
      let index = queue.findIndex((element) => { return element.id == data.data[0].id; });
      if (index >= 0) {
        let removed = queue.splice(index, 1);
        refreshQueue();
      }
    } else if (data.action == 'NOW_PLAYING') {
      nowPlaying = data.data.shift();
      refreshNowPlaying();
    } else if (data.action == 'PLAY_STATUS') {
      refreshPlayButton(data.isPlaying);
    } else if (data.action == 'PLAY_TIME') {
      refreshStatusBar(data.time_played, data.time_total);
    } else if (data.action == 'INIT_CLIENT') {
      document.getElementById('header-title').innerText = `${data.name} Playlist Controller`
    } else if (data.action == 'LOADING_STREAM') {
      let spinner = document.getElementById('spinner-container');
      if (data.loading) {
        spinner.style.display = 'inherit';
      } else {
        spinner.style.display = 'none';
      }
    }
  };
}

/* Do all the things*/
getWebSocketPort();