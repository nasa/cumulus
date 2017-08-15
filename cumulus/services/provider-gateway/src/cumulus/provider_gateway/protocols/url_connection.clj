(ns cumulus.provider-gateway.protocols.url-connection)

(defprotocol UrlConnection
  "TODO"

  (close
   [conn]
   "Closes the underlying connection")

  (download
   [conn url]
   "Returns the contents of the URL as an Input stream. Returns nil if the file does not exist."))
