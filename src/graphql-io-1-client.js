/*
**  GraphQL-IO -- GraphQL Network Communication Framework
**  Copyright (c) 2016-2017 Ralf S. Engelschall <rse@engelschall.com>
**
**  Permission is hereby granted, free of charge, to any person obtaining
**  a copy of this software and associated documentation files (the
**  "Software"), to deal in the Software without restriction, including
**  without limitation the rights to use, copy, modify, merge, publish,
**  distribute, sublicense, and/or sell copies of the Software, and to
**  permit persons to whom the Software is furnished to do so, subject to
**  the following conditions:
**
**  The above copyright notice and this permission notice shall be included
**  in all copies or substantial portions of the Software.
**
**  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
**  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
**  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
**  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
**  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
**  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
**  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/*  external dependencies  */
import StdAPI         from "stdapi"
import Axios          from "axios"
import UUID           from "pure-uuid"
import Ducky          from "ducky"
import ApolloClient   from "apollo-client"
import ApolloClientWS from "apollo-client-ws"

/*  internal dependencies  */
import Query          from "./graphql-io-2-query"

/*  the exported API class  */
export default class Client extends StdAPI {
    constructor (options) {
        super(options, {
            prefix:      [ "string", "GraphQL-IO-" ],
            url:         [ "/^https?:\\/\\/.+?:\\d+(?:\\/.*)?$/", "http://127.0.0.1:8080/api" ],
            path: {
                login:   [ "/^(?:|\\/.+)$/", "/auth/login" ],
                session: [ "/^(?:|\\/.+)$/", "/auth/session" ],
                logout:  [ "/^(?:|\\/.+)$/", "/auth/logout" ],
                graph:   [ "/^(?:|\\/.+)$/", "/data/graph" ],
                blob:    [ "/^(?:|\\/.+)$/", "/data/blob" ]
            },
            mode:        [ "/^(?:http|websocket)$/", "websocket" ],
            encoding:    [ "/^(?:cbor|msgpack|json)$/", "json" ],
            typenames:   [ "boolean", false ],
            debug:       [ "number", 0 ]
        })

        /*  initialize internal state  */
        this._.nsUUID           = new UUID(5, "ns:URL", "http://graphql-io.com/ns/")
        this._.loginUsername    = ""
        this._.loginPassword    = ""
        this._.graphql          = null
        this._.subscriptions    = {}
        this._.networkInterface = null
        this._.token            = null
        this._.peer             = null
    }

    /*  INTERNAL: raise a fatal error  */
    error (err) {
        this.debug(1, `ERROR: ${err}`)
        this.emit("error", err)
        return this
    }

    /*  connect to the backend endpoints  */
    async connect () {
        this.debug(2, "connect to backend")

        /*  create an Apollo Client network interface  */
        if (this.$.mode === "http") {
            /*  create HTTP-based interface  */
            this.debug(3, "create HTTP-based network interface")
            this._.networkInterface = ApolloClient.createNetworkInterface({
                uri: `${this.$.url}${this.$.path.graph}`,
                opts: {
                    credentials: "same-origin"
                }
            })
        }
        else if (this.$.mode === "websocket") {
            /*  create WebSocket-based interface  */
            this.debug(3, "create WebSocket-based network interface")
            this._.networkInterface = ApolloClientWS.createNetworkInterface({
                uri: `${this.$.url.replace(/^http(s?):/, "ws$1:")}${this.$.path.graph}`,
                opts: {
                    keepalive: 0,
                    debug:     this.$.debug,
                    encoding:  this.$.encoding
                }
            })

            /*  pass-though debug messages  */
            this._.networkInterface.on("debug", ({ date, level, msg, log }) => {
                this.debug(2 + level, `[apollo-client-ws]: ${msg}`)
            })
        }
        else
            throw new Error("invalid communication mode")

        /*  add middleware to auto-logout/login on HTTP 401 responses  */
        this._.networkInterface.useAfter([{
            applyAfterware: async (response, next) => {
                if (   response === "object"
                    && response !== null
                    && response.status === 401) {
                    await this.logout(true)
                    await this.login(true)
                }
                next()
            }
        }])

        /*  hook into WebSocket creation to send authentication cookie and peer id
            (Notice: called under Node environment only, but for Browser
            environments this is not necessary, as Cookie is sent automatically)  */
        this._.networkInterface.at("connect:options", (options) => {
            if (this._.token !== null && this._.peer !== null) {
                if (!options.headers)
                    options.headers = {}
                options.headers.Cookie =
                    `${this.$.prefix}Token=${this._.token}; ` +
                    `${this.$.prefix}Peer=${this._.peer}`
            }
            return options
        })

        /*  provide a mapper for the unique ids of entities
            (important for Apollo Client in order to cache correcly)  */
        const dataIdFromObject = (obj) => {
            if (typeof obj === "object" && typeof obj.id === "string")
                /*  take "id" field  */
                return obj.id
            else if (typeof obj === "object" && typeof obj.__id === "string")
                /*  take "__id" field  */
                return obj.__id
            else {
                /*  create a UUID  */
                return new UUID(5, this._.nsUUID, JSON.stringify(obj)).format()
            }
        }

        /*  create the Apollo Client instance  */
        this._.graphql = new ApolloClient({
            networkInterface: this._.networkInterface,
            dataIdFromObject: dataIdFromObject,
            addTypename:      this.$.typenames
        })

        /*  react on subscription messages  */
        if (this.$.mode === "websocket") {
            this._.networkInterface.on("receive", ({ type, data }) => {
                if (type === "GRAPHQL-NOTIFY" && Ducky.validate(data, "[ string* ]")) {
                    this.debug(1, `GraphQL notification for subscriptions: ${data.join(", ")}`)
                    data.forEach((sid) => {
                        if (typeof this._.subscriptions[sid] === "object") {
                            this.debug(2, `refetch query of subscription ${sid}`)
                            this._.subscriptions[sid].refetch()
                        }
                    })
                }
            })
        }

        /*  perform an initial connect  */
        if (this.$.mode === "websocket")
            await this._.networkInterface.connect()

        return this
    }

    /*  disconnect from the backend endpoints  */
    async disconnect () {
        /*  perform a final disconnect  */
        this.debug(2, "disconnect from backend")
        if (this.$.mode === "websocket")
            await this._.networkInterface.disconnect()

        /*  cleanup  */
        this._.graphql          = null
        this._.networkInterface = null
        return this
    }

    /*  perform a login  */
    async login (implicit = false) {
        this.debug(2, `login at backend (${implicit ? "implicitly" : "explicit"})`)

        /*  determine credentials  */
        if (!implicit) {
            let { username, password } = await this.hook("login-credentials", "pass",
                { username: this._.loginUsername, password: this._.loginPassword })
            this._.loginUsername = username
            this._.loginPassword = password
        }

        /*  send credentials to backend  */
        return Axios.post(`${this.$.url}${this.$.path.login}`, {
            username: this._.loginUsername,
            password: this._.loginPassword
        }).then(async (response) => {
            /*  remember token and peer (for use in non-browser environment
                where we have to manually send them as cookies back)  */
            if (   typeof response === "object"
                && typeof response.data === "object"
                && typeof response.data.token === "string") {
                this._.token = response.data.token
                this._.peer  = response.data.peer
            }

            /*  for WebSocket connections, force a re-establishment  */
            if (this.$.mode === "websocket") {
                await this._.networkInterface.disconnect()
                await this._.networkInterface.connect()
            }
            return true
        }, (err) => {
            this.error(`login failed: ${err}`)
            return false
        })
    }

    /*  perform a logout  */
    logout (implicit = false) {
        this.debug(2, `logout at backend (${implicit ? "implicitly" : "explicit"})`)
        return Axios.get(`${this.$.url}${this.$.path.logout}`).then(() => {
            this._.loginUsername = null
            this._.loginPassword = null
            this._.token = null
            this._.peer  = null
            return true
        }, (err) => {
            this.error(`logout failed: ${err}`)
            return false
        })
    }

    /*  check session information  */
    session () {
        this.debug(2, "check session at backend")
        return Axios.get(`${this.$.url}${this.$.path.session}`).then(({ data }) => {
            return data
        }, (err) => {
            this.error(`session check failed: ${err}`)
            return null
        })
    }

    /*  query  */
    query (query, vars = {}, opts = {}) {
        const onError = (err) => {
            if (   typeof err === "object"
                && err !== null
                && typeof err.graphQLErrors === "object"
                && err.graphQLErrors instanceof Array   ) {
                let error = err.graphQLErrors[0]
                let path = (typeof error.path === "object" && error.path instanceof Array ? error.path[0] : "")
                this.error(`${path} failed: ${error.message}`)
            }
            else
                this.error(`${err.message}`)
        }
        return new Query(this, onError, query, vars, opts)
    }

    /*  fetch  */
    fetch (name) {
        this.debug(2, `fetching BLOB "${name}"`)
        return Axios.get(`${this.$.url}${this.$.path.blob}/${name}`).then((data) => {
            return data
        }, (err) => {
            this.error(`fetchin of BLOB "${name}" failed: ${err}`)
            return null
        })
    }
}

