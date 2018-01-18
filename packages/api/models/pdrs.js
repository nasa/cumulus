'use strict';

const pvl = require('@cumulus/pvl');
const { errorify } = require('../lib/utils');
const Manager = require('./base');
//const Provider = require('./providers');
const pdrSchema = require('./schemas').pdr;


class Pdr extends Manager {
  constructor() {
    super(process.env.PDRsTable, pdrSchema);
  }

  static buildRecord(pdrName, provider, originalUrl) {
    return {
      pdrName: pdrName,
      provider: provider,
      originalUrl: originalUrl,
      status: 'discovered',
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      discoveredAt: Date.now()
    };
  }

  /**
   * Depending on the type of Error, this method might
   * generate a PDRD message for the providers
   *
   */
  async hasCompleted(pdrName, _obj) {
    const obj = _obj;
    obj.status = 'completed';
    obj.isActive = false;

    // shortPan
    // It is a success shortPan if all granules in the PDR are completed
    if (obj.granules === obj.granulesStatus.completed) {
      // generate PDRD message
      const pan = pvl.jsToPVL(
        new pvl.models.PVLRoot()
               .add('MESSAGE_TYPE', new pvl.models.PVLTextString('SHORTPAN'))
               .add('DISPOSITION', new pvl.models.PVLTextString('SUCCESSFUL'))
               .add('TIME_STAMP', new pvl.models.PVLDateTime(new Date()))
      );

      obj.PAN = pan;

      // write the PAN message
      //const pr = new Provider();
      try {
        const pdr = await this.get({ pdrName });
        console.log(pdr.provider);
        //const provider = await pr.get({ name: pdr.provider });

        //if (provider.panFolder && provider.protocol === 'ftp') {
          //const password = await pr.decryptPassword(provider.config.password);

          //const w = new FtpPan(provider, pdrName, provider.config.username, password);
          //await w.write(pan, 'PAN');
          //obj.PANSent = true;
        //}
        //else {
        obj.PANSent = false;
        //}
      }
      catch (e) {
        obj.PANSent = false;
      }
    }

    return this.update({ pdrName }, obj);
  }

  /**
   * Depending on the type of Error, this method might
   * generate a PDRD message for the providers
   *
   */
  async hasFailed(key, err) {
    const values = {
      status: 'failed',
      error: errorify(err),
      isActive: false
    };

    //if (err instanceof PDRParsingError) {
      //// generate PDRD message
      //const pdrd = pvl.jsToPVL(
        //new pvl.models.PVLRoot()
               //.add('MESSAGE_TYPE', new pvl.models.PVLTextString('SHORTPDRD'))
               //.add('DISPOSITION', new pvl.models.PVLTextString(err.message))
      //);

      //values.PDRD = pdrd;
      //values.PDRDSent = false;
    //}

    return this.update(key, values);
  }
}

module.exports = Pdr;
