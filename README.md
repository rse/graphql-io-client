
[GraphQL-IO-Meta](https://github.com/rse/graphql-io) &nbsp;|&nbsp;
[GraphQL-IO-Server](https://github.com/rse/graphql-io-server) &nbsp;|&nbsp;
[GraphQL-IO-Client](https://github.com/rse/graphql-io-client)

<img src="https://rawgit.com/rse/graphql-io/master/graphql-io.svg" width="250" align="right" alt=""/>

GraphQL-IO-Client
=================

GraphQL Network Communication Framework (Client)

<p/>
<img src="https://nodei.co/npm/graphql-io-client.png?downloads=true&stars=true" alt=""/>

<p/>
<img src="https://david-dm.org/rse/graphql-io-client.png" alt=""/>

About
-----

This is a [GraphQL](http://graphql.org/) network communication framework for
JavaScript clients, running under either Node.js or in the Browser.
It is based on the GraphQL engine [GraphQL.js](http://graphql.org/graphql-js/), the
GraphQL client library [Apollo Client](https://github.com/apollographql/apollo-client), its
WebSocket network interface [Apollo Client WS](https://github.com/rse/apollo-client-ws)
and the HTTP client library [Axios](https://github.com/mzabriskie/axios). It has be used
with the corresponding [GraphQL-IO-Server](https://github.com/rse/graphql-io-server)
network communication framework on the JavaScript server side.

Installation
------------

```shell
$ npm install graphql-io-client
```

Usage
-----

```js
import { Client } from "graphql-io-client"

const sv = new Client({
    url:        "http://127.0.0.1:12345/api",
    path:       { graph: "" },
    debugWrite: (msg) => { console.error(msg) },
    debugLevel: 2
})

(async () => {
    await sv.connect()

    sv.query(`subscription {
        OrgUnits {
            id
            name
            director   { id name }
            parentUnit { id name }
            members    { id name }
        }
    }`).subscribe((response) => {
        console.log("OK 1:", require("util").inspect(response, { colors: true, depth: null }))
    }, (err) => {
        console.log("ERROR 1:", err)
    })
)()

...FIXME...
```

License
-------

Copyright (c) 2016-2017 Ralf S. Engelschall (http://engelschall.com/)

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

