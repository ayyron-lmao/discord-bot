const fs = require('fs');

class ConfigManager {

  constructor(filename) {
    this.obj = null;
    this.filename = filename;
  }

  save() {
    fs.writeFileSync(this.filename, JSON.stringify(this.obj));
  }

  load() {
    this.obj = JSON.parse(fs.readFileSync(this.filename, 'ascii'));
  }

  get(node, defaultValue) {
    let path = node.split('.');
    let temp = this.obj;
    for (let n in path) {
      if (temp[path[n]]) {
        temp = temp[path[n]];
      } else {
        console.log('node \'' + node + '\' does not exist in config tree. Stuck at: ' + path[n]);
        return defaultValue;
      }
    }
    return temp;
  }

  set(node, value) {
    let path = node.split('.');
    let lastn = '';
    let parent = null;
    let current = this.obj;
    for (let n in path) {
      parent = current;
      if (current[path[n]]) {
        current = current[path[n]];
        lastn = path[n];
      } else {
        lastn = path[n];
        current[path[n]] = {};
        current = current[path[n]];
      }
    }
    if (current) {
      parent[lastn] = value;
      this.save();
    } 
    return current;
  }
}

function newConfig(filename) {
  return new ConfigManager(filename);
}

module.exports = {ConfigManager, newConfig};