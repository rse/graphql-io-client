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
import Latching       from "latching"
import EventEmitter   from "eventemitter3"
import Axios          from "axios"
import UUID           from "pure-uuid"
import Ducky          from "ducky"
import ApolloClient   from "apollo-client"
import ApolloClientWS from "apollo-client-ws"
import Optioner       from "optioner"
import Joi            from "joi"

/*  internal dependencies  */
import Query          from "./graphql-io-2-query"

/*  the exported API class  */
export default class Client extends EventEmitter {
    constructor (options) {
        super()

        /*  define internal state  */
        Object.defineProperty(this, "_", {
            configurable: false,
            enumerable:   false,
            writable:     false,
            value:        {}
        })

        /*  determine options  */
        let optioner = Optioner({
            url:         Joi.string().regex(/^https?:\/\/.+?:\d+\/.*$/).default("http://127.0.0.1:8080/api"),
            path: {
                login:   Joi.string().empty().allow("").regex(/^(?:|\/.+)$/).default("/auth/login"),
                session: Joi.string().empty().allow("").regex(/^(?:|\/.+)$/).default("/auth/session"),
                logout:  Joi.string().empty().allow("").regex(/^(?:|\/.+)$/).default("/auth/logout"),
                graph:   Joi.string().empty().allow("").regex(/^(?:|\/.+)$/).default("/data/graph"),
                blob:    Joi.string().empty().allow("").regex(/^(?:|\/.+)$/).default("/data/blob")
            },
            cid:         Joi.string().default((new UUID(1)).format()),
            mode:        Joi.string().regex(/^(?:http|websocket)$/).default("websocket"),
            encoding:    Joi.string().regex(/^(?:cbor|msgpack|json)$/).default("json"),
            debug:       Joi.number().integer().min(0).max(3).default(0)
        })
        optioner(options, (err, options) => {
            if (err)
                throw new Error(err)
            this._.options = options
        })

        /*  initialize internal state  */
        this._.nsUUID           = new UUID(5, "ns:URL", "http://engelschall.com/ns/graphql-io")
        this._.loginUsername    = ""
        this._.loginPassword    = ""
        this._.graphql          = null
        this._.subscriptions    = {}
        this._.networkInterface = null

        /*  provide latching sub-system  */
        this._.latching = new Latching()
    }

    /*  pass-through latching sub-system  */
    hook    (...args) { return this._.latching.hook(...args) }
    at      (...args) { return this._.latching.at(...args) }
    latch   (...args) { return this._.latching.latch(...args) }
    unlatch (...args) { return this._.latching.unlatch(...args) }

    /*  raise a fatal error  */
    error (err) {
        this.log(1, `ERROR: ${err}`)
        this.emit("error", err)
    }

    /*  raise a debug message  */
    log (level, msg) {
        if (level <= this._.options.debug) {
            let date = (new Date()).toISOString()
            let log = `${date} DEBUG [${level}]: ${msg}`
            this.emit("debug", { date, level, msg, log })
        }
    }

    /*  connect to the backend endpoints  */
    async connect () {
        this.log(1, "connect to backend")

        /*  create an Apollo Client network interface  */
        if (this._.options.mode === "http") {
            /*  create HTTP-based interface  */
            this.log(2, "create HTTP-based network interface")
            this._.networkInterface = ApolloClient.createNetworkInterface({
                uri: `${this._.options.url}${this._.options.path.graph}`,
                opts: {
                    credentials: "same-origin"
                }
            })
        }
        else if (this._.options.mode === "websocket") {
            /*  create WebSocket-based interface  */
            this.log(2, "create WebSocket-based network interface")
            this._.networkInterface = ApolloClientWS.createNetworkInterface({
                uri: `${this._.options.url.replace(/^http(s?):/, "ws$1:")}${this._.options.path.graph}`,
                opts: {
                    keepalive: 0,
                    debug:     this._.options.debug,
                    encoding:  this._.options.encoding
                }
            })

            /*  pass-though debug messages  */
            this._.networkInterface.on("debug", ({ date, level, msg, log }) => {
                this.log(level, `[apollo-client-ws]: ${msg}`)
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
                    await this.logout()
                    await this.login()
                }
                next()
            }
        }])

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
            addTypename:      true
        })

        /*  react on subscription messages  */
        if (this._.options.mode === "websocket") {
            this._.networkInterface.on("receive", ({ type, data }) => {
                if (type === "GRAPHQL-NOTIFY" && Ducky.validate(data, "[ string* ]")) {
                    this.log(2, `received GRAPHQL-NOTIFY message for SIDs: ${data.join(", ")}`)
                    data.forEach((sid) => {
                        if (typeof this._.subscriptions[sid] === "object") {
                            this.log(3, `refetch query of subscription ${sid}`)
                            this._.subscriptions[sid].refetch()
                        }
                    })
                }
            })
        }

        /*  perform an initial connect  */
        if (this._.options.mode === "websocket")
            await this._.networkInterface.connect()
    }

    /*  disconnect from the backend endpoints  */
    async disconnect () {
        this.log(1, "disconnect from backend")
        if (this._.options.mode === "websocket")
            await this._.networkInterface.disconnect()
        this._.graphql          = null
        this._.networkInterface = null
    }

    /*  perform a login  */
    async login () {
        /*  determine credentials  */
        let { username, password } = await this.hook("login-credentials", "pass",
            { username: this._.loginUsername, password: this._.loginPassword })
        this._.loginUsername = username
        this._.loginPassword = password

        /*  send credentials to backend  */
        this.log(1, "login at backend")
        return Axios.post(`${this._.options.url}${this._.options.path.login}`, {
            deviceId: this._.options.cid,
            username: this._.loginUsername,
            password: this._.loginPassword
        }).then(async () => {
            /*  nothing to be done here, as response contains access token
                in a Cookie header which is used by Browser automatically
                on any further communication  */
            if (this._.options.mode === "websocket") {
                /*  just for WebSocket connections, force a re-establishment  */
                await this._.networkInterface.disconnect()
                await this._.networkInterface.connect()
            }
            return true
        }, (err) => {
            this.error(`login failed: ${err}`)
            return false
        })
    }

    /*  check session information  */
    session () {
        this.log(1, "check session at backend")
        return Axios.get(`${this._.options.url}${this._.options.path.session}`).then(({ data }) => {
            return data
        }, (err) => {
            this.error(`session check failed: ${err}`)
            return null
        })
    }

    /*  perform a logout  */
    logout () {
        this.log(1, "logout at backend")
        return Axios.get(`${this._.options.url}${this._.options.path.logout}`).then(() => {
            this._.loginUsername = null
            this._.loginPassword = null
            return true
        }, (err) => {
            this.error(`logout failed: ${err}`)
            return false
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

    /*  convenience function for debugging purposes only  */
    async gql (query, vars = {}, opts = {}) {
        /* eslint no-console: off */

        /*  perform a hard logout/login cycle  */
        await this.logout()
        await this.login()

        /*  pass-through execution to Apollo Client  */
        opts = Object.assign({}, opts, { fetchPolicy: "network-only" })
        let result = this.query(query, vars, opts)
        result.then((result) => {
            console.log("gql: OK:", result.data)
        }, (err) => {
            if (   typeof err.graphQLErrors === "object"
                && err.graphQLErrors instanceof Array   ) {
                err.graphQLErrors.forEach((err) => {
                    if (typeof err.path === "object" && err.path instanceof Array)
                        console.error("gql: ERROR: path: ", err.path.join(" / ") + ":")
                    console.error("gql: ERROR: message: ",  err.message)
                })
            }
            else
                console.error("gql: ERROR:", err)
        })
    }
}

