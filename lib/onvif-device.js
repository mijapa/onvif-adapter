/**
 * ONVIF device type.
 */
'use strict';

const {Device} = require('gateway-addon');
const OnvifProperty = require('./onvif-property');

const SNAPSHOT_INTERVAL = 10 * 1000;
const DEBUG = false;

/**
 * ONVIF device type.
 */
class OnvifDevice extends Device {
  /**
   * Initialize the object.
   *
   * @param {Object} adapter - OnvifAdapter instance
   * @param {Object} data - Discovery data
   * @param {Object} camera - Initialize OnvifDevice object from node-onvif
   */
  constructor(adapter, data, camera) {
    let id = data.urn.split(':');
    id = `onvif-${id[id.length - 1]}`;
    const info = camera.getInformation();

    super(adapter, id);
    this.camera = camera;
    this.urn = data.urn;
    this.name = data.name;
    this.description = `${info.Manufacturer} ${info.Model}`;
    this['@context'] = 'https://iot.mozilla.org/schemas';
    this['@type'] = [];

    camera.add('snapshot');

    const profile = camera.getDefaultProfile();
    if (DEBUG) {
      console.log(JSON.stringify(profile, null, 2));
    }

    this.properties.set(
      'streamUrl',
      new OnvifProperty(
        this,
        'streamUrl',
        {
          label: 'Stream URL',
          type: 'string',
          readOnly: true,
        },
        profile.StreamUri.Uri,
      )
    );
    this.properties.set(
      'videoEncoding',
      new OnvifProperty(
        this,
        'videoEncoding',
        {
          label: 'Video Encoding',
          type: 'string',
          readOnly: true,
        },
        profile.VideoEncoderConfiguration.Encoding,
      )
    );
    this.properties.set(
      'videoResolution',
      new OnvifProperty(
        this,
        'videoResolution',
        {
          label: 'Video Resolution',
          type: 'string',
          readOnly: true,
        },
        `${profile.VideoEncoderConfiguration.Resolution.Width}x${
          profile.VideoEncoderConfiguration.Resolution.Height}`,
      )
    );
    this.properties.set(
      'videoBitRate',
      new OnvifProperty(
        this,
        'videoBitRate',
        {
          label: 'Video Bit Rate',
          type: 'number',
          readOnly: true,
        },
        parseInt(profile.VideoEncoderConfiguration.RateControl.BitrateLimit,
                 10),
      )
    );
    this.properties.set(
      'videoFrameRate',
      new OnvifProperty(
        this,
        'videoFrameRate',
        {
          label: 'Video Frame Rate',
          type: 'number',
          readOnly: true,
        },
        parseInt(profile.VideoEncoderConfiguration.RateControl.FrameRateLimit,
                 10),
      )
    );
    this.properties.set(
      'videoQuality',
      new OnvifProperty(
        this,
        'videoQuality',
        {
          label: 'Video Quality',
          type: 'number',
          readOnly: true,
        },
        parseInt(profile.VideoEncoderConfiguration.Quality, 10),
      )
    );
    this.properties.set(
      'snapshotMimeType',
      new OnvifProperty(
        this,
        'snapshotMimeType',
        {
          label: 'Snapshot MIME Type',
          type: 'string',
          readOnly: true,
        },
        null
      )
    );
    this.properties.set(
      'snapshot',
      new OnvifProperty(
        this,
        'snapshot',
        {
          label: 'Snapshot',
          type: 'binary',
          readOnly: true,
        },
        null
      )
    );

    if (profile.AudioEncoderConfiguration) {
      this.properties.set(
        'audioEncoding',
        new OnvifProperty(
          this,
          'audioEncoding',
          {
            label: 'Audio Encoding',
            type: 'string',
            readOnly: true,
          },
          profile.AudioEncoderConfiguration.Encoding,
        )
      );
      this.properties.set(
        'audioBitRate',
        new OnvifProperty(
          this,
          'audioBitRate',
          {
            label: 'Audio Bit Rate',
            type: 'number',
            readOnly: true,
          },
          parseInt(profile.AudioEncoderConfiguration.Bitrate, 10),
        )
      );
      this.properties.set(
        'audioSampleRate',
        new OnvifProperty(
          this,
          'audioSampleRate',
          {
            label: 'Audio Sample Rate',
            type: 'number',
            readOnly: true,
          },
          parseInt(profile.AudioEncoderConfiguration.SampleRate, 10),
        )
      );
    }

    if (camera.ptz) {
      this.addAction(
        'move',
        {
          label: 'Move',
          input: {
            type: 'object',
            required: [
              'speedX',
              'speedY',
              'speedZ',
            ],
            properties: {
              speedX: {
                type: 'number',
                minimum: -1.0,
                maximum: 1.0,
              },
              speedY: {
                type: 'number',
                minimum: -1.0,
                maximum: 1.0,
              },
              speedZ: {
                type: 'number',
                minimum: -1.0,
                maximum: 1.0,
              },
              timeout: {
                type: 'number',
                minimum: 0,
                unit: 'seconds',
              },
            },
          },
        }
      );
      this.addAction(
        'stop',
        {
          label: 'Stop',
        }
      );
    }

    if (camera.events) {
      // TODO: set up events properly
      camera.events.getEventProperties().then(console.log);

      camera.events.on('messages', (messages) => {
        console.log('Got events:', messages);
      });

      camera.events.on('messages:error', (error) => {
        console.error(`Messages error: ${error}`);
      });

      camera.events.startPull();
    }

    setInterval(() => {
      this.snapshot().then(({mimeType, buffer}) => {
        const mime = this.properties.get('snapshotMimeType');
        if (mime.value === null) {
          mime.setCachedValue(mimeType);
          this.notifyPropertyChanged(mime);
        }

        const snapshot = this.properties.get('snapshot');
        snapshot.setCachedValue(buffer.toString('base64'));
        this.notifyPropertyChanged(snapshot);
      }).catch((e) => {
        console.error(`Error fetching snapshot: ${e}`);
      });
    }, SNAPSHOT_INTERVAL);
  }

  /**
   * Take a snapshot.
   *
   * @returns {Promise} Promise which resolves to an Object containining MIME
   *                    type and snapshot buffer.
   */
  snapshot() {
    return this.camera.snapshot.getSnapshot().then((res) => {
      return {
        mimeType: res.mimeType,
        buffer: res.image,
      };
    });
  }

  /**
   * Perform an action.
   *
   * @param {Object} action - Action to perform
   */
  performAction(action) {
    switch (action.name) {
      case 'move': {
        action.start();

        const velocity = {
          x: action.input.speedX,
          y: action.input.speedY,
          z: action.input.speedZ,
        };

        let timeout = null;
        if (typeof action.input.timeout === 'number') {
          timeout = action.input.timeout;
        }

        return this.camera.ptz.continuousMove(null, velocity, timeout)
          .then(() => {
            action.finish();
          }).catch((e) => {
            console.error(`Failed to move camera: ${e}`);
            action.status = 'error';
            this.actionNotify(action);
          });
      }
      case 'stop':
        action.start();
        return this.camera.ptz.stop().then(() => {
          action.finish();
        }).catch((e) => {
          console.error(`Failed to stop camera: ${e}`);
          action.status = 'error';
          this.actionNotify(action);
        });
      default:
        action.status = 'error';
        this.actionNotify(action);
        return Promise.resolve();
    }
  }
}

module.exports = OnvifDevice;
