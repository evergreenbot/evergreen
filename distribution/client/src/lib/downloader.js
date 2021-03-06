/*
 * The Downloader is responsible for only downloading of URLs to local files on
 * disk and checking them against provided checksums.
 */

const fs     = require('fs');
const path   = require('path');
const url    = require('url');

const rp      = require('promise-request-retry');
const logger  = require('winston');
const mkdirp  = require('mkdirp');

const Checksum = require('./checksum');
const UI       = require('./ui');

class Downloader {
  constructor() {
  }

  static formatDuration(durationInMs) {
    if (durationInMs < 1000) {
      return `${durationInMs}ms`;
    }
    const seconds = Math.floor(durationInMs / 1000);
    const millisecs = durationInMs - 1000 * seconds;
    return `${seconds}.${millisecs}s`;
  }

  /*
   * Download the specified URL to the directory as the filename
   *
   * @param {string} the full URL
   * @param {string} a full output directory
   * @param {string} the filename to output at
   * @parma {string} Optional sha256 signature to verify of the file
   */
  static download(item, dir, fileNameToWrite, sha256, downloadOptions = {}) {
    const itemUrl = url.parse(item);
    const itemUrlBaseName = path.basename(itemUrl.pathname);

    if (!itemUrlBaseName) {
      throw new Error(`The URL must end with a non-empty path. E.g. http://jenkins.io/something.html instead of https://jenkins.io/ (received URL=${itemUrl})`);
    }

    mkdirp.sync(dir);

    const filename = [dir, fileNameToWrite].join(path.sep);

    UI.publish(`Fetching ${filename}`);
    logger.info('Fetching %s and saving to %s', item, filename);

    let options = {
      uri: item,
      verboseLogging: true,
      method: 'GET',
      headers: {
        'User-Agent': 'evergreen-client'
      },
      simple: true,
      resolveWithFullResponse: true,
      encoding: null,
      timeout: 120 * 1000,
      retry: downloadOptions.retry || 10,
      delay: downloadOptions.delay || 1000,
      factor: downloadOptions.factor || 1.2
    };

    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      rp(options)
        .then((response) => {
          const elapsedString = Downloader.formatDuration(Date.now() - startTime);
          logger.info ('Download complete for', filename, `(Took ${elapsedString})`);
          UI.publish(`Fetched ${filename} in ${elapsedString}s`);

          const output = fs.createWriteStream(filename);

          output.on('close', () => {
            logger.debug('Downloaded %s (%d bytes)', filename, output.bytesWritten);
            if (sha256) {
              logger.debug('Verifying signature for', filename);
              const downloaded = Checksum.signatureFromFile(filename);

              if (sha256 != downloaded) {
                // Our messages are displayed in reverse order in the UI :)
                UI.publish('Jenkins may fail to start properly! Please check your network connection');
                UI.publish(`Signature verification failed for ${filename}! (${downloaded} != ${sha256})`, { log: 'error' });
                return reject(new Error(`Signature verification failed for ${filename}`));
              } else {
                logger.debug(`Correct checksum (${sha256}) for`, filename);
              }
            }
            return resolve(output);
          });
          output.write(response.body);
          output.end();
        })
        .catch((err) => {
          logger.error('Error %s occurred while fetching %s and saving to %s', err, item, filename);
          return reject(err);
        });
    });
  }
}

module.exports = Downloader;
