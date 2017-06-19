
[GraphQL-IO-Meta](https://github.com/rse/graphql-io) &nbsp;|&nbsp;
[GraphQL-IO-Client](https://github.com/rse/graphql-io-client) &nbsp;|&nbsp;
[GraphQL-IO-Server](https://github.com/rse/graphql-io-server)

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

Simple "Hello World":

```js
const { Client } = require("graphql-io-client")
;(async () => {
    const sv = new Client()
    await sv.connect()
    let result = await sv.query("{ hello }")
    console.log(result.data)
    await sv.disconnect()
})()
```

Complex Example:

```js
/*  external requirements  */
const { inspect } = require("util")
const { Client }  = require("graphql-io-client")

/*  helper function for dumping data structure  */
const dump = (data) => {
    if (process.browser)
        data = JSON.stringify(data, null, "    ")
    else
        data = inspect(data, { colors: true, depth: null })
    return data
}

/*  create a GraphQL-IO client service instance  */
const newService = async (id) => {
    const sv = new Client({
        url:      "http://127.0.0.1:12345/api",
        path:     { graph: "" },
        encoding: "cbor",
        debug:    1
    })
    sv.on("debug", ({ log }) => {
        console.error(`${id}: ${log}`)
    })
    await sv.connect()
    return sv
}

/*  execute asynchronous function in a wrapping procedure  */
;(async () => {
    /*  create two client service instances  */
    const sv1 = await newService("sv1")
    const sv2 = await newService("sv2")

    /*  the first service continuously queries...  */
    let subscription = sv1.query(`subscription {
        OrgUnits {
            id
            name
            director   { id name }
            parentUnit { id name }
            members    { id name }
        }
    }`).subscribe((response) => {
        console.log(`sv1: response: ${dump(response)}`)
    }, (err) => {
        console.log(`sv1: ERROR: ${err}`)
    })

    /*  the second service manipulates multiple times...  */
    let cnt = 0
    let timer = setInterval(async () => {
        await sv2.query(`mutation ($with: JSON!) {
            OrgUnit (id: "XT") {
                update(with: $with) {
                    name
                }
            }
        }`, {
            with: {
                name: `dummy${cnt}`
            }
        }).then((response) => {
            console.log(`sv2: response: ${dump(response)}`)
        }, (err) => {
            console.log(`sv2: ERROR: ${err}`)
        })
        if (cnt++ >= 2) {
            /*  stop processing  */
            clearTimeout(timer)
            setTimeout(async () => {
                await subscription.unsubscribe()
                await sv1.disconnect()
                if (!process.browser)
                    process.exit(0)
            }, 1 * 1000)
        }
    }, 1 * 1000)
})().catch((err) => {
    console.log(`global: ERROR: ${err}`)
})
```

Application Programming Interface (API)
---------------------------------------

See the [TypeScript type definition of the GraphQL-IO-Client API](src/graphql-io.d.ts) for details.

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

