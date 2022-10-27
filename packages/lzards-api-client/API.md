# API

## Functions

<dl>
<dt><a href="#getAuthToken">getAuthToken(getSecretStringFunction, getLaunchpadTokenFunction)</a> ⇒ <code>Promise.&lt;string&gt;</code></dt>
<dd><p>Retrieve Launchpad Auth Token</p>
</dd>
<dt><a href="#submitQueryToLzards">submitQueryToLzards(params)</a> ⇒ <code>Promise.&lt;Object&gt;</code></dt>
<dd><p>Submit query to LZARDS</p>
</dd>
</dl>

<a name="getAuthToken"></a>

## getAuthToken(getSecretStringFunction, getLaunchpadTokenFunction) ⇒ <code>Promise.&lt;string&gt;</code>
Retrieve Launchpad Auth Token

**Kind**: global function  
**Returns**: <code>Promise.&lt;string&gt;</code> - - resolves to a Launchpad Token string  

| Param | Type | Description |
| --- | --- | --- |
| getSecretStringFunction | <code>function</code> | function used to retrieve a secret from AWS |
| getLaunchpadTokenFunction | <code>function</code> | function used to retrieve cached Launchpad token |

<a name="submitQueryToLzards"></a>

## submitQueryToLzards(params) ⇒ <code>Promise.&lt;Object&gt;</code>
Submit query to LZARDS

**Kind**: global function  
**Returns**: <code>Promise.&lt;Object&gt;</code> - - resolves to the LZARDS return  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| params.lzardsApiUri | <code>string</code> | LZARDS endpoint url |
| params.searchParams | <code>Object</code> | object containing search parameters to pass to lzards |
| params.getAuthTokenFunction | <code>function</code> | function used to get a launchpad auth token |


---

Generated automatically using `npm run build-docs`
