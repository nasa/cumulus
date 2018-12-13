'use strict';

// DataMapper base class
class DataMapper {
  async insert() {
    throw new Error('Not implemented');
  }

  async update() {
    throw new Error('Not implemented');
  }

  async delete() {
    throw new Error('Not implemented');
  }
}
module.exports = DataMapper;
