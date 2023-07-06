
function FindProxyForURL(url, host) {
 
    if (dnsDomainIs(host, "<API-ID>.execute-api.us-east-1.amazonaws.com"))
        return "SOCKS5 localhost:8081";
 
    if (dnsDomainIs(host, "<TEA-API-ID>.execute-api.us-east-1.amazonaws.com"))
        return "SOCKS5 localhost:8081";
 
    // by default use no proxy
    return "DIRECT";
}