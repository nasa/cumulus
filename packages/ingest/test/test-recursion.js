'use strict';

const test = require('ava');

const recursion = require('../recursion');

test('recursion lists all files in default directory and subdirectories when originalPath is empty',
  async (t) => {
    const dirs = {
      '.': [
        { type: 'd', name: 'dir' },
        { type: '-', name: 'file1' },
        { type: '-', name: 'file2' }
      ],
      dir: [
        { type: '-', name: 'file3' }
      ]
    };
    const fn = (path) => dirs[path];
    const files = await recursion(fn, '');
    t.deepEqual(files, [
      { type: '-', name: 'file3' },
      { type: '-', name: 'file1' },
      { type: '-', name: 'file2' }
    ]);
  });

test('recursion does not pick up files along the way when listing a specific path.', async (t) => {
  const dirs = {
    '/': [
      { type: 'd', name: 'path' },
      { type: '-', name: 'file1' },
      { type: '-', name: 'file2' }
    ],
    '/path': [
      { type: 'd', name: 'to' },
      { type: '-', name: 'file3' }
    ],
    '/path/to': [
      { type: 'd', name: 'files' },
      { type: '-', name: 'file4' }
    ],
    '/path/to/files': [
      { type: '-', name: 'targetedfile' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, '/path/to/files');
  t.deepEqual(files, [{ type: '-', name: 'targetedfile' }]);
});

test('recursion lists all files in a simple relative text path', async (t) => {
  const dirs = {
    '.': [
      { type: 'd', name: 'path' }
    ],
    path: [
      { type: '-', name: 'file1' },
      { type: '-', name: 'file2' },
      { type: '-', name: 'file3' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, 'path');
  t.deepEqual(files, dirs.path);
});

test('recursion lists all files in a simple absolute text path', async (t) => {
  const dirs = {
    '/': [
      { type: 'd', name: 'path' }
    ],
    '/path': [
      { type: '-', name: 'file1' },
      { type: '-', name: 'file2' },
      { type: '-', name: 'file3' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, '/path');
  t.deepEqual(files, dirs['/path']);
});

test('recursion lists all files in a simple relative regex path', async (t) => {
  const dirs = {
    '.': [
      { type: 'd', name: 'dir1' },
      { type: 'd', name: 'dir2' }
    ],
    dir1: [
      { type: '-', name: 'file1' },
      { type: '-', name: 'file2' },
      { type: '-', name: 'file3' }
    ],
    dir2: [
      { type: '-', name: 'file4' },
      { type: '-', name: 'file5' },
      { type: '-', name: 'file6' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, '(dir.*)');
  t.deepEqual(files, [...dirs.dir1, ...dirs.dir2]);
});

test('recursion lists all files in a simple absolute regex path', async (t) => {
  const dirs = {
    '/': [
      { type: 'd', name: 'dir1' },
      { type: 'd', name: 'dir2' }
    ],
    '/dir1': [
      { type: '-', name: 'file1' },
      { type: '-', name: 'file2' },
      { type: '-', name: 'file3' }
    ],
    '/dir2': [
      { type: '-', name: 'file4' },
      { type: '-', name: 'file5' },
      { type: '-', name: 'file6' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, '/(dir.*)');
  t.deepEqual(files, [...dirs['/dir1'], ...dirs['/dir2']]);
});

test('recursion lists all files in a complex relative text path', async (t) => {
  const dirs = {
    '.': [
      { type: 'd', name: 'path' }
    ],
    path: [
      { type: 'd', name: 'to' }
    ],
    'path/to': [
      { type: 'd', name: 'files' },
      { type: '-', name: 'file1' }
    ],
    'path/to/files': [
      { type: '-', name: 'file2' },
      { type: '-', name: 'file3' },
      { type: '-', name: 'file4' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, 'path');
  t.deepEqual(files, [...dirs['path/to/files'], dirs['path/to'][1]]);
});

test('recursion lists all files in a complex absolute text path', async (t) => {
  const dirs = {
    '/': [
      { type: 'd', name: 'path' }
    ],
    '/path': [
      { type: 'd', name: 'to' }
    ],
    '/path/to': [
      { type: 'd', name: 'files' },
      { type: '-', name: 'file1' }
    ],
    '/path/to/files': [
      { type: '-', name: 'file2' },
      { type: '-', name: 'file3' },
      { type: '-', name: 'file4' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, '/path');
  t.deepEqual(files, [...dirs['/path/to/files'], dirs['/path/to'][1]]);
});

test('recursion lists all files in a complex relative regex path', async (t) => {
  const dirs = {
    '.': [
      { type: 'd', name: 'dir1' },
      { type: 'd', name: 'dir2' }
    ],
    dir1: [
      { type: 'd', name: 'good1' },
      { type: 'd', name: 'bad1' }
    ],
    'dir1/good1': [
      { type: '-', name: 'goodfile1' },
      { type: '-', name: 'badfile1' }
    ],
    'dir1/bad1': [
      { type: '-', name: 'badfile2' }
    ],
    dir2: [
      { type: 'd', name: 'good2' },
      { type: 'd', name: 'bad2' }
    ],
    'dir2/good2': [
      { type: '-', name: 'goodfile2' },
      { type: '-', name: 'badfile3' }
    ],
    'dir2/bad2': [
      { type: '-', name: 'badfile4' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, '(dir.*)/(g.*)/(g.*f.*)');
  t.deepEqual(files, [
    { type: '-', name: 'goodfile1' },
    { type: '-', name: 'goodfile2' }
  ]);
});

test('recursion lists all files in a complex absolute regex path', async (t) => {
  const dirs = {
    '/': [
      { type: 'd', name: 'dir1' },
      { type: 'd', name: 'dir2' }
    ],
    '/dir1': [
      { type: 'd', name: 'good1' },
      { type: 'd', name: 'bad1' }
    ],
    '/dir1/good1': [
      { type: '-', name: 'goodfile1' },
      { type: '-', name: 'badfile1' }
    ],
    '/dir1/bad1': [
      { type: '-', name: 'badfile2' }
    ],
    '/dir2': [
      { type: 'd', name: 'good2' },
      { type: 'd', name: 'bad2' }
    ],
    '/dir2/good2': [
      { type: '-', name: 'goodfile2' },
      { type: '-', name: 'badfile3' }
    ],
    '/dir2/bad2': [
      { type: '-', name: 'badfile4' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, '/(dir.*)/(g.*)/(g.*f.*)');
  t.deepEqual(files, [
    { type: '-', name: 'goodfile1' },
    { type: '-', name: 'goodfile2' }
  ]);
});

test('recursion lists all files in a simple composite relative text/regex path', async (t) => {
  const dirs = {
    '.': [
      { type: 'd', name: 'dir' },
      { type: '-', name: 'notlisted' }
    ],
    dir: [
      { type: 'd', name: 'files1' },
      { type: 'd', name: 'files2' }
    ],
    'dir/files1': [
      { type: '-', name: 'file1' },
      { type: '-', name: 'file2' }
    ],
    'dir/files2': [
      { type: '-', name: 'file3' },
      { type: '-', name: 'file4' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, 'dir/(file.*)');
  t.deepEqual(files, [...dirs['dir/files1'], ...dirs['dir/files2']]);
});

test('recursion lists all files in a simple composite absolute text/regex path', async (t) => {
  const dirs = {
    '/': [
      { type: 'd', name: 'dir' },
      { type: '-', name: 'notlisted' }
    ],
    '/dir': [
      { type: 'd', name: 'files1' },
      { type: 'd', name: 'files2' }
    ],
    '/dir/files1': [
      { type: '-', name: 'file1' },
      { type: '-', name: 'file2' }
    ],
    '/dir/files2': [
      { type: '-', name: 'file3' },
      { type: '-', name: 'file4' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, '/dir/(file.*)');
  t.deepEqual(files, [...dirs['/dir/files1'], ...dirs['/dir/files2']]);
});

test('recursion lists all files in a complex composite relative text/regex path', async (t) => {
  const dirs = {
    '.': [
      { type: 'd', name: 'dir1' },
      { type: 'd', name: 'dir2' }
    ],
    dir1: [
      { type: 'd', name: 'good' },
      { type: 'd', name: 'bad' }
    ],
    'dir1/good': [
      { type: '-', name: 'goodfile1' },
      { type: '-', name: 'badfile1' }
    ],
    'dir1/bad': [
      { type: '-', name: 'badfile2' }
    ],
    dir2: [
      { type: 'd', name: 'good' },
      { type: 'd', name: 'bad' }
    ],
    'dir2/good': [
      { type: '-', name: 'goodfile2' },
      { type: '-', name: 'badfile3' }
    ],
    'dir2/bad': [
      { type: '-', name: 'badfile4' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, '(dir.*)/good/(goodfile.*)');
  t.deepEqual(files, [
    { type: '-', name: 'goodfile1' },
    { type: '-', name: 'goodfile2' }
  ]);
});

test('recursion lists all files in a complex composite absolute text/regex path', async (t) => {
  const dirs = {
    '/': [
      { type: 'd', name: 'dir1' },
      { type: 'd', name: 'dir2' }
    ],
    '/dir1': [
      { type: 'd', name: 'good' },
      { type: 'd', name: 'bad' }
    ],
    '/dir1/good': [
      { type: '-', name: 'goodfile1' },
      { type: '-', name: 'badfile1' }
    ],
    '/dir1/bad': [
      { type: '-', name: 'badfile2' }
    ],
    '/dir2': [
      { type: 'd', name: 'good' },
      { type: 'd', name: 'bad' }
    ],
    '/dir2/good': [
      { type: '-', name: 'goodfile2' },
      { type: '-', name: 'badfile3' }
    ],
    '/dir2/bad': [
      { type: '-', name: 'badfile4' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, '/(dir.*)/good/(goodfile.*)');
  t.deepEqual(files, [
    { type: '-', name: 'goodfile1' },
    { type: '-', name: 'goodfile2' }
  ]);
});

test('recursion can handle text paths with terminating slash', async (t) => {
  const dirs = {
    '.': [
      { type: 'd', name: 'path' }
    ],
    path: [
      { type: 'd', name: 'files' }
    ],
    'path/files': [
      { type: '-', name: 'file1' },
      { type: '-', name: 'file2' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, 'path/files/');
  t.deepEqual(files, dirs['path/files']);
});

test('recursion can handle regex paths with terminating slash', async (t) => {
  const dirs = {
    '.': [
      { type: 'd', name: 'dir1' }
    ],
    dir1: [
      { type: '-', name: 'file1' },
      { type: '-', name: 'file2' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, '(dir.*)/');
  t.deepEqual(files, dirs.dir1);
});

test('recursion can handle text paths with leading slash', async (t) => {
  const dirs = {
    '/': [
      { type: 'd', name: 'path' }
    ],
    '/path': [
      { type: 'd', name: 'files' }
    ],
    '/path/files': [
      { type: '-', name: 'file1' },
      { type: '-', name: 'file2' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, '/path/files');
  t.deepEqual(files, dirs['/path/files']);
});

test('recursion can handle regex paths with leading slash', async (t) => {
  const dirs = {
    '/': [
      { type: 'd', name: 'dir1' }
    ],
    '/dir1': [
      { type: '-', name: 'file1' },
      { type: '-', name: 'file2' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, '/(dir.*)');
  t.deepEqual(files, dirs['/dir1']);
});

test('recursion replaces duplicated slashes with a single slash', async (t) => {
  const dirs = {
    '/': [
      { type: 'd', name: 'dir' }
    ],
    '/dir': [
      { type: 'd', name: 'files' }
    ],
    '/dir/files': [
      { type: '-', name: 'file1' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, '///dir/////files///');
  t.deepEqual(files, dirs['/dir/files']);
});

test('recursion falls back to directly listing the path and subdirectores when filtering'
 + 'encounters an error', async (t) => {
  const dirs = {
    '.': () => {
      throw new Error('Permission Denied');
    },
    'path/to/files': () => [
      { type: 'd', name: 'dir' },
      { type: '-', name: 'file2' }
    ],
    'path/to/files/dir': () => [
      { type: '-', name: 'file1' }
    ]
  };
  const fn = (path) => dirs[path]();
  const files = await recursion(fn, 'path/to/files');
  t.deepEqual(files, [
    { type: '-', name: 'file1' },
    { type: '-', name: 'file2' }
  ]);
});


test('recursion supports both - and 0 types for listed files', async (t) => {
  const dirs = {
    '.': [
      { type: '-', name: 'file1' },
      { type: 0, name: 'file2' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, '.');
  t.deepEqual(files, dirs['.']);
});

test('recursion supports both d and 1 types for listed dirs', async (t) => {
  const dirs = {
    '/': [
      { type: 'd', name: 'dir1' },
      { type: 1, name: 'dir2' }
    ],
    '/dir1': [
      { type: '-', name: 'file1' }
    ],
    '/dir2': [
      { type: '-', name: 'file2' }
    ]
  };
  const fn = (path) => dirs[path];
  const files = await recursion(fn, '/(dir.)*');
  t.deepEqual(files, [...dirs['/dir1'], ...dirs['/dir2']]);
});
