# Cumulus Task: run-gdal

Runs gdal binaries as a Cumulus task

## Inputs and Outputs

See the example folder for a full envelope example.

Payload input: A single S3 object reference or array of references (if a list, the first one is used). The downloaded S3 object will be used as the input to GDAL

Payload output: An array of S3 object references representing the output file(s) produced when running GDAL

An S3 object reference has this shape:
```js
{
  "bucket": "some-bucket", // The S3 Bucket containing the object
  "key": "some/s3/key"     // The S3 key path to the object
}
```

Config:

```js
{
  "input_filename": "some-file.tif",      // The filename to use for the input file
  "commands": [                          // An array of gdal commands to be run sequentially
    {
      "gdal_command": "gdalwarp",        // The gdal command. Only binaries bundled with gdal are valid
      "args": ["cli-arg-1", "cli-arg-2"] // CLI arguments to pass to the command
    }
  ],
  "outputs": [                           // An array of files to upload to S3 and use as output
    {
      "filename": "some-output.png",     // The filename on disk of the file to upload (likely produced by gdal)
      "dest": {                          // The destination S3 object reference (see above)
        "bucket": "some-bucket",
        "key": "some/output/key.png"
      }
    }
  ]
}
```   

## Installing

`npm install --save @cumulus/run-gdal`

