(ns cumulus.provider-gateway.protocols.url-connection)

(defprotocol UrlConnection
  "Defines a protocol for interacting with URLS to download data."

  (close
   [conn]
   "Closes the underlying connection")

  (get-size
   [conn url]
   "Attempts to get the size of the data at the given URL without actually downloading the data.
    Returns nil if unable to access the data")

  (download
   [conn url]
   "Returns the contents of the URL as an Input stream. Returns nil if the file does not exist."))
