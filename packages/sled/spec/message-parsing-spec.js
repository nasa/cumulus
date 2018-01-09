/* global describe, it, expect */

const sled = require('../index').handler;

const createMessage = (props) => ({
  workflow_config: { Example: props.config },
  cumulus_meta: {
    task: 'Example',
    message_source: 'local',
    id: 'id-1234'
  },
  meta: props.meta || { foo: 'bar' },
  payload: props.payload || { anykey: 'anyvalue' }
});

const runTestHandler = (event, cb) => {
  const callback = (err, data) => {
    if (err) throw err;
    cb(data);
  };

  const testHandler = (evt, context, response) => {
    response(null, evt);
  };

  sled(event, {}, callback, testHandler);
};

describe('Message Parsing', () => {
  it('passes its config object in the "config" key', (done) => {
    runTestHandler(createMessage({
      config: { hello: 'world' }
    }), (response) => {
      expect(response.payload.config).toEqual({ hello: 'world' });
      done();
    });
  });

  it('passes its payload object in the "input" key', (done) => {
    runTestHandler(createMessage({
      payload: { hello: 'world' }
    }), (response) => {
      expect(response.payload.input).toEqual({ hello: 'world' });
      done();
    });
  });

  it('returns its meta verbatim', (done) => {
    runTestHandler(createMessage({
      meta: { hello: 'world' }
    }), (response) => {
      expect(response.meta).toEqual({ hello: 'world' });
      done();
    });
  });

  it('preserves its workflow_config', (done) => {
    runTestHandler(createMessage({
      config: { hello: 'world' }
    }), (response) => {
      expect(response.workflow_config).toEqual({ Example: { hello: 'world' } });
      done();
    });
  });

  it('sets "exception" to "None" upon successful invocation', (done) => {
    runTestHandler(Object.assign(createMessage({}), { Exception: 'Something' }),
      (response) => {
        expect(response.exception).toEqual('None');
        done();
      });
  });

  describe('handling of JSONPaths in config', () => {
    it('resolves plain strings in the config as themselves', (done) => {
      runTestHandler(createMessage({
        config: { hello: 'wor{ld' }
      }), (response) => {
        expect(response.payload.config).toEqual({ hello: 'wor{ld' });
        done();
      });
    });

    it('resovles strings containing single-curly-braced JSONPath expressions by ' +
       'replacing them with their string value', (done) => {
      runTestHandler(createMessage({
        config: { hello: 'world {meta.somekey}' },
        meta: { somekey: 'somevalue' }
      }), (response) => {
        expect(response.payload.config).toEqual({ hello: 'world somevalue' });
        done();
      });
    });

    it('resovles strings enclosed in double-curly-braced JSONPath expressions by ' +
       'replacing them with the first object matching the expression', (done) => {
      runTestHandler(createMessage({
        config: { hello: '{{meta..world}}' },
        meta: {
          somekey: [
            { world: 'world1' },
            { world: 'world2' }
          ]
        }
      }), (response) => {
        expect(response.payload.config).toEqual({ hello: 'world1' });
        done();
      });
    });

    it('resovles strings enclosed in curly-and-square-braced JSONPath expressions by ' +
       'replacing them with an array of all matching objects', (done) => {
      runTestHandler(createMessage({
        config: { hello: '{[meta..world]}' },
        meta: {
          somekey: [
            { world: 'world1' },
            { world: 'world2' }
          ]
        }
      }), (response) => {
        expect(response.payload.config).toEqual({ hello: ['world1', 'world2'] });
        done();
      });
    });
  });

  describe('handling of cumulus_message in config', () => {
    it('removes cumulus_message from the config passed to the handler', (done) => {
      runTestHandler(createMessage({
        config: {
          hello: 'world',
          cumulus_message: {
          }
        }
      }), (response) => {
        expect(response.payload.config).toEqual({ hello: 'world' });
        done();
      });
    });

    it('allows the "input" key to override the use of payload as input', (done) => {
      runTestHandler(createMessage({
        config: {
          cumulus_message: {
            input: '{{$.meta.input}}'
          }
        },
        meta: {
          input: { hello: 'world' }
        }
      }), (response) => {
        expect(response.payload.input).toEqual({ hello: 'world' });
        done();
      });
    });

    it('allows the "outputs" key to override where the handler output is placed', (done) => {
      runTestHandler(createMessage({
        config: {
          cumulus_message: {
            outputs: [
              {
                source: '{{$.input}}',
                destination: '{{$.meta.output}}'
              }
            ]
          }
        },
        meta: {},
        payload: { hello: 'world' }
      }), (response) => {
        expect(response.meta).toEqual({ output: { hello: 'world' } });
        done();
      });
    });

    it('sets payload to the empty object when "outputs" does not set it', (done) => {
      runTestHandler(createMessage({
        config: {
          cumulus_message: {
            outputs: [
              {
                source: '{{$.input}}',
                destination: '{{$.meta.output}}'
              }
            ]
          }
        },
        meta: {},
        payload: { hello: 'world' }
      }), (response) => {
        expect(response.payload).toEqual({});
        done();
      });
    });
  });
});

