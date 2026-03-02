# @cumulus/sftp-client

> A Promise-based SFTP client

## Install

```shell
npm install @cumulus/sftp-client
```

## Usage

```js
const { SftpClient } = require("@cumulus/sftp-client");

(async () => {
  const sftpClient = new SftpClient({
    host: "ssh.example.com",
    port: 2222,
    username: "my-username",
    password: "my-password"
  });

  await sftpClient.connect();
  console.log(await sftpClient.list("./"));
  await sftpClient.end();
})();
```

## API

---

### constructor(config)

#### config

Type: `object`

#### config.host

Type: `string`

The hostname or IP address of the remote SFTP server.

#### config.port

Type: `number`<br>
Default: `22`

The TCP port to connect to.

#### config.username

Type: `string`

The username to use when connecting to the SFTP server.

#### config.password

Type: `string`

The password to use when connecting to the SFTP server.

#### config.privateKey

Type: `string`

A private key to use when connecting to the SFTP server.

---

### sftpClient.download(remotePath, localPath)

Download a remote file to disk. Returns a `Promise` that resolves to a `string`
containing the local path that the file was saved to.

#### remotePath

Type: `string`

The full path to the remote file to be fetched

#### localPath

Type: `string`

The full local destination file path

---

### sftpClient.end()

Close the connect to the SFTP server.

---

### sftpClient.list(remotePath)

Returns a `Promise` that resolves to an `array` of `object`s containing information about discovered files.

The returned file `object`s will each contain `name`, `path`, `type`, `size`, and `time` fields.

#### remotePath

Type: `string`

The remote path to be listed.

---
### sftpClient.sftp()

Returns the `ssh2-sftp-client` Client as a convenience.

---

### sftpClient.syncFromS3(s3Object, remotePath)

Returns a `Promise` that resolves to `undefined` once a file has been transferred from S3 to the SFTP server.

#### s3Object

Type: `object`

#### s3Object.Bucket

Type: `string`

The bucket containing the S3 object to be transferred to the SFTP server.

#### s3Object.Key

Type: `string`

The key of the S3 object to be transferred to the SFTP server.

#### remotePath

Type: `string`

The full remote destination file path.

---

### sftpClient.syncToS3(remotePath, bucket, key)

Returns a `Promise` that resolves to a `string` containing the S3 URI of the destination file

#### remotePath

Type: `string`

The full path to the remote file to be fetched

#### bucket

Type: `string`

Destination S3 bucket of the file

#### key

Type: `string`

Destination S3 key of the file

---

### sftpClient.unlink(remotePath)

Returns a `Promise` that resolves to `undefined` once the remote file has been deleted.

#### remotePath

Type: `string`

The path to file on the SFTP server to be deleted
