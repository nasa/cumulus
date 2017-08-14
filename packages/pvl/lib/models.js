'use strict';

const areIDsSame = require('./utils').areIDsSame;

class PVLAggregate {
  constructor () {
    this.store = [];
  }

  add (key, value) {
    this.store.push([key, value]);
    return this;
  }
  get (key) { return this.store.find(item => item[0] === key) ? this.store.find(item => item[0] === key)[1] : null; }
  getAll (key) { return this.store.filter(item => item[0] === key).map(item => item[1]); }
  removeAll (key) { this.store = this.store.filter(item => item[0] !== key); }

  // Since OBJECT and GROUP are reserved keywords, this won't collide with attribute keys
  addAggregate (aggregate) {
    this.store.push([aggregate.type, aggregate]);
    return this;
  }
  objects (key) { return this.getAll('OBJECT').filter(o => key ? areIDsSame(o.identifier, key) : true); }
  groups (key) { return this.getAll('GROUP').filter(g => key ? areIDsSame(g.identifier, key) : true); }
  aggregates (key) { return this.objects(key).concat(this.groups(key)); }

  toPVL () {
    return this.store.reduce(
      (last, curr) => last.concat(`${curr[0]} = ${curr[1].toPVL()};\n`),
      `${this.identifier};\n`
    ).concat(`END_${this.type} = ${this.identifier}`);
  }
}

class PVLRoot extends PVLAggregate {
  constructor () {
    super();
    this.type = 'ROOT';
    this.depth = 0;
  }
  toPVL () { return this.store.reduce((last, curr) => last.concat(`${curr[0]} = ${curr[1].toPVL()};\n`), ''); }
}

class PVLObject extends PVLAggregate {
  constructor (identifier) {
    super();
    this.identifier = identifier;
    this.type = 'OBJECT';
  }
}

class PVLGroup extends PVLAggregate {
  constructor (identifier) {
    super();
    this.identifier = identifier;
    this.type = 'GROUP';
  }
}

class PVLValue {}

class PVLScalar extends PVLValue {
  constructor (value) {
    super(value);
    this.value = value;
  }
}

// class PVLSequence extends PVLValue {
//   constructor (value) {
//     super()
//     this.type = 'sequence'
//   }
// }

// class PVLSet extends PVLValue {
//   constructor (value) {
//     super()
//     this.type = 'set'
//   }
// }

class PVLNumeric extends PVLScalar {
  constructor (value, units) {
    super(value);
    this.value = Number(this.value);
    if (typeof units === 'string') { this.units = units.toUpperCase(); }
    this.type = 'numeric';
  }
  toPVL () { return this.units ? `${this.value} <${this.units}>` : `${this.value}`; }
}

class PVLDateTime extends PVLScalar {
  constructor (value) {
    super(value);
    this.value = new Date(this.value);
    this.type = 'date time';
  }
  toPVL () { return this.value.toISOString(); }
}

// class PVLDate extends PVLScalar {
//   constructor (value) {
//     super(value)
//     this.type = 'date'
//   }
// }

// class PVLTime extends PVLScalar {
//   constructor (value) {
//     super(value)
//     this.type = 'time'
//   }
// }

class PVLTextString extends PVLScalar {
  constructor (value) {
    super(value);
    this.type = 'text string';
  }
  toPVL () { return this.value.includes('"') ? `'${this.value}'` : `"${this.value}"`; }
}

module.exports = {
  PVLAggregate: PVLAggregate,
  PVLRoot: PVLRoot,
  PVLObject: PVLObject,
  PVLGroup: PVLGroup,
  PVLNumeric: PVLNumeric,
  PVLDateTime: PVLDateTime,
  PVLTextString: PVLTextString
};
