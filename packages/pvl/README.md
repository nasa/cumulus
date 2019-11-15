# @cumulus/pvl

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## PVL

A JS module to parse and serialize Parameter Value Language, a data markup language used by NASA.

### How-to

#### Parse

```js
> const pvl = require('./pvl/index.js')

> const input = (`
ORIGINATING_SYSTEM = "ASTER_FTP";
OBJECT = "FILE_GROUP";
    DATA_TYPE = "AST_L1A";
    OBJECT = "FILE_SPEC";
        FILE_ID = "pg-PR1A0000-2017040601_000_001";
        FILE_TYPE = "SCIENCE";
        FILE_SIZE = 116503123;
    END_OBJECT = "FILE_SPEC";
    OBJECT = "FILE_SPEC";
        FILE_ID = "pg-BR1A0000-2017040601_000_001";
        FILE_TYPE = "BROWSE";
        FILE_SIZE = 166428;
    END_OBJECT = "FILE_SPEC";
END_OBJECT = "FILE_GROUP"
`)

> const parsed = pvl.pvlToJS(input)

> parsed
PVLRoot {
  store: [ [ 'ORIGINATING_SYSTEM', [Object] ], [ 'OBJECT', [Object] ] ],
  type: 'ROOT',
  depth: 0 }

> JSON.stringify(parsed)
'{"store":[["ORIGINATING_SYSTEM",{"value":"ASTER_FTP","type":"text string"}],["OBJECT",{"store":[["DATA_TYPE",{"value":"AST_L1A","type":"text string"}],["OBJECT",{"store":[["FILE_ID",{"value":"pg-PR1A0000-2017040601_000_001","type":"text string"}],["FILE_TYPE",{"value":"SCIENCE","type":"text string"}],["FILE_SIZE",{"value":116503123,"type":"numeric"}]],"identifier":"FILE_SPEC","type":"OBJECT"}],["OBJECT",{"store":[["FILE_ID",{"value":"pg-BR1A0000-2017040601_000_001","type":"text string"}],["FILE_TYPE",{"value":"BROWSE","type":"text string"}],["FILE_SIZE",{"value":166428,"type":"numeric"}]],"identifier":"FILE_SPEC","type":"OBJECT"}]],"identifier":"FILE_GROUP","type":"OBJECT"}]],"type":"ROOT","depth":0}'
```

#### Serialize

```js
...
> const serialized = pvl.jsToPVL(parsed)

> console.log(serialized)
ORIGINATING_SYSTEM = "ASTER_FTP";
OBJECT = FILE_GROUP;
  DATA_TYPE = "AST_L1A";
  OBJECT = FILE_SPEC;
    FILE_ID = "pg-PR1A0000-2017040601_000_001";
    FILE_TYPE = "SCIENCE";
    FILE_SIZE = 116503123;
  END_OBJECT = FILE_SPEC;
  OBJECT = FILE_SPEC;
    FILE_ID = "pg-BR1A0000-2017040601_000_001";
    FILE_TYPE = "BROWSE";
    FILE_SIZE = 166428;
  END_OBJECT = FILE_SPEC;
END_OBJECT = FILE_GROUP;

```

#### Traverse the object and get values

```js
...
> parsed.get('ORIGINATING_SYSTEM')  // Get the item with the given key
PVLTextString { value: 'ASTER_FTP', type: 'text string' }

> parsed.get('ORIGINATING_SYSTEM').value  // Access its value
'ASTER_FTP'

> parsed.getAll('ORIGINATING_SYSTEM')  // Since PVL allows duplicate keys
[ PVLTextString { value: 'ASTER_FTP', type: 'text string' } ]

> parsed.aggregates()  // Get all OBJECTs and GROUPs
[ PVLObject {
    store: [ [Object], [Object], [Object] ],
    identifier: 'FILE_GROUP',
    type: 'OBJECT' } ]

> parsed.objects()  // Get all OBJECTs
[ PVLObject {
    store: [ [Object], [Object], [Object] ],
    identifier: 'FILE_GROUP',
    type: 'OBJECT' } ]

> parsed.objects('FILE_GROUP')  // Get all OBJECTs with a given name
[ PVLObject {
    store: [ [Object], [Object], [Object] ],
    identifier: 'FILE_GROUP',
    type: 'OBJECT' } ]

> parsed.aggregates()[0].aggregates()[1].get('FILE_ID').value  // Dig deep
'pg-BR1A0000-2017040601_000_001'
```

#### Roll your own

```js
...
> const PVLRoot = pvl.models.PVLRoot
> const PVLTextString = pvl.models.PVLTextString
> const PVLGroup = pvl.models.PVLGroup

> const simple = new PVLRoot().add('FOO', new PVLTextString('BAR')).add('BAZ', new PVLTextString('QUX'))

> simple
PVLRoot {
  store: [ [ 'FOO', [Object] ], [ 'BAZ', [Object] ] ],
  type: 'ROOT',
  depth: 0 }

> console.log(pvl.jsToPVL(simple))
FOO = "BAR";
BAZ = "QUX";

> const complex = new PVLRoot().addAggregate(new PVLGroup('FOO').add('BAR', new PVLTextString('BAZ'))).addAggregate(new PVLGroup('QUX').add('BAR', new PVLTextString('FIZZ')))

> complex
PVLRoot {
  store: [ [ 'GROUP', [Object] ], [ 'GROUP', [Object] ] ],
  type: 'ROOT',
  depth: 0 }

> console.log(pvl.jsToPVL(complex))
GROUP = FOO;
  BAR = "BAZ";
END_GROUP = FOO;
GROUP = QUX;
  BAR = "FIZZ";
END_GROUP = QUX;

```

### Tests

Run tests with `npm test`.

### Language specs

- [Spec for PVL](https://pirlwww.lpl.arizona.edu/software/PPVL/CCSDS-641.0-B-2.pdf)
- [Tutorial for PVL](https://public.ccsds.org/Pubs/641x0g2.pdf)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
