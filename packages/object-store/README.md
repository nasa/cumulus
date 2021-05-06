# @cumulus/object-store

Utilities for returning an object store regardless of cloud provider.

## Usage

```bash
  npm install @cumulus/object-store
```

## Functions

<dl>
<dt><a href="#objectStoreForProtocol">objectStoreForProtocol</a> ⇒ <code>S3ObjectStore</code> | <code>undefined</code> ⏏</dt>
<dd><p>Returns a class to interact with the object store appropriate for the provided protocol if it exists. Currently only the S3 protocol is supported</p>
</dd>
<dt><a href="#defaultObjectStore">defaultObjectStore</a> ⇒ <code>S3ObjectStore</code> ⏏</dt>
<dd><p>Returns the default object store, which is S3.</p>
</dd>
</dl>

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
