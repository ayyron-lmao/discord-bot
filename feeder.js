const feeder = require('feederjs');

const options = {
  year: '2-digit',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short'
};
const americanDateTime = new Intl.DateTimeFormat('en-US', options).format;
let config = null;
let client = null;

function checkRssUpdates() {
  // get feeds to check
  var feeds = config.get('rss', {});
  Object.keys(feeds).forEach((value, index) => {
    // retreive feed from site
    feeder.getFeed(feeds[value].url, (feed) => {
      if (feed instanceof feeder.FeederException) {
        console.log(`error getting RSS: ${feed}`);
        return;
      }
      // get dates
      var feedConf = getFeedConfig(feed.title);
      if (!feedConf) {
        console.log(`error getting config for feed: ${feed}`);
        return;
      }
      var lastUpdate = new Date(feedConf.lastUpdate);
      var updateTime = new Date(cleanDate(feed.entrys[0].updated));
      // check dates to see if new
      if (feedConf.lastUpdate.length == 0 || updateTime > lastUpdate) {
        // its new, so fucking update
        messageAllGuildsDefaultChannel("**" + feed.title + " News Update!**\n\n" + feed.entrys[0].title +
          ' (' + americanDateTime(new Date(cleanDate(feed.entrys[0].updated))) +
          ')\n' + feed.entrys[0].link[0].href);
        // update the config with the latest update date.
        feedConf.lastUpdate = cleanDate(feed.entrys[0].updated);
        config.save();
        console.log(feed.title + ' udpate!');
      }
    });
  });
}

function cleanDate(date) {
  return date.replace('Z', '');
}

function getFeedConfig(name) {
  let feeds = config.get('rss', {});
  let xResult = null;
  Object.keys(feeds).forEach((value, index) => {
    if (feeds[value].name === name) {
      xResult = feeds[value];
    }
  });
  return xResult;
}

function messageAllGuildsDefaultChannel(message) {
  client.guilds.every((element, index, array) => {
    let channel = element.defaultChannel;
    if (channel) {
      channel.send(message)
        .then((message) => { console.log('Sent message to:' + message.guild.name); })
        .catch(console.error);
      return true;
    }
    else { return false }
  });
}

function startRSS(con, cli) {
  config = con;
  client = cli;
  setInterval(checkRssUpdates, 60000);
}

module.exports = { startRSS };
