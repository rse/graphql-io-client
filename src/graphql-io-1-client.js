/*
**  GraphQL-IO -- GraphQL Network Communication Framework
**  Copyright (c) 2016-2019 Ralf S. Engelschall <rse@engelschall.com>
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
import StdAPI             from "stdapi"
import Axios              from "axios"
import UUID               from "pure-uuid"
import Ducky              from "ducky"
import { ApolloClient }   from "apollo-client"
import { ApolloClientWS } from "apollo-client-ws"
import { ApolloLink }     from "apollo-link"
import { HttpLink }       from "apollo-link-http"
import { onError }        from "apollo-link-error"
import { InMemoryCache }  from "apollo-cache-inmemory"
import CrossFetch         from "cross-fetch"
import { OSet }           from "oset"
import Chunking           from "chunking"

/*  internal dependencies  */
import Query              from "./graphql-io-2-query"

/*  the exported API class  */
export default class Client extends StdAPI {
    constructor (options) {
        super(options, {
            prefix:      [ "string", "GraphQL-IO-" ],
            url:         [ "/^https?:\\/\\/.+?(?::\\d+)?$/", "http://127.0.0.1:8080" ],
            path: {
                login:   [ "/^\\/.+$/", "/api/auth/login" ],
                session: [ "/^\\/.+$/", "/api/auth/session" ],
                logout:  [ "/^\\/.+$/", "/api/auth/logout" ],
                graph:   [ "/^\\/.+$/", "/api/data/graph" ],
                blob:    [ "/^\\/.+$/", "/api/data/blob" ]
            },
            mode:        [ "/^(?:http|websocket)$/", "websocket" ],
            encoding:    [ "/^(?:cbor|msgpack|json)$/", "json" ],
            compress:    [ "boolean", false ],
            typenames:   [ "boolean", false ],
            throttle:    [ "number", 250 ],
            debug:       [ "number", 0 ]
        })

        /*  initialize internal state  */
        this._.nsUUID           = new UUID(5, "ns:URL", "http://graphql-io.com/ns/")
        this._.loginUsername    = ""
        this._.loginPassword    = ""
        this._.graphqlClient    = null
        this._.graphqlLinkErr   = null
        this._.graphqlLinkNet   = null
        this._.graphqlCache     = null
        this._.subscriptions    = {}
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

        /*  create networking Apollo Link instance  */
        if (this.$.mode === "http") {
            /*  create HTTP-based interface (not recommended)  */
            this.debug(3, "create HTTP-based network interface")
            this._.graphqlLinkNet = new HttpLink({
                uri: `${this.$.url}${this.$.path.graph}`,
                opts: {
                    credentials: "same-origin",
                    fetch:       CrossFetch
                }
            })
        }
        else if (this.$.mode === "websocket") {
            /*  create WebSocket-based interface (recommended)  */
            this.debug(3, "create WebSocket-based network interface")
            this._.graphqlLinkNet = new ApolloClientWS({
                uri: `${this.$.url.replace(/^http(s?):/, "ws$1:")}${this.$.path.graph}`,
                opts: {
                    keepalive: 0,
                    debug:     this.$.debug,
                    encoding:  this.$.encoding,
                    compress:  this.$.compress
                }
            })

            /*  pass-through Apollo-Client-WS debug messages  */
            this._.graphqlLinkNet.on("debug", ({ date, level, msg, log }) => {
                this.debug(2 + level, `[apollo-client-ws]: ${msg}`)
            })

            /*  detect and pass-through some events  */
            this._.graphqlLinkNet.on("connect",    () => { this.emit("connect") })
            this._.graphqlLinkNet.on("disconnect", () => { this.emit("disconnect") })
            this._.graphqlLinkNet.on("open",       () => { this.emit("open") })
            this._.graphqlLinkNet.on("close",      () => { this.emit("close") })

            /*  hook into WebSocket creation to send authentication cookie and peer id
                (Notice: called under Node environment only, but for Browser
                environments this is not necessary, as Cookie is sent automatically)  */
            this._.graphqlLinkNet.at("connect:options", (options) => {
                if (this._.token !== null && this._.peer !== null) {
                    if (!options.headers)
                        options.headers = {}
                    options.headers.Cookie =
                        `${this.$.prefix}Token=${this._.token}; ` +
                        `${this.$.prefix}Peer=${this._.peer}`
                }
                return options
            })
        }
        else
            throw new Error("invalid communication mode")

        /*  create error handling Apollo Link instance  */
        this._.graphqlLinkErr = onError((error) => {
            if (   typeof error === "object"
                && typeof error.networkError === "object"
                && error.networkError.status === 401) {
                /*  auto-logout/login on HTTP 401 responses  */
                this.logout(true).then(() => {
                    this.login(true)
                })
            }
            else if (   typeof error === "object"
                     && typeof error.networkError === "object") {
                /*  pass-through all other network errors  */
                this.error(`network error: ${error.networkError.toString()}`)
            }
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

        /*  create the Apollo Client Cache instance  */
        this._.graphqlCache = new InMemoryCache({
            dataIdFromObject: dataIdFromObject,
            addTypename:      this.$.typenames
        })

        /*  create the Apollo Client instance  */
        this._.graphqlClient = new ApolloClient({
            cache: this._.graphqlCache,
            link:  ApolloLink.from([
                this._.graphqlLinkErr,
                this._.graphqlLinkNet
            ])
        })

        /*  react on subscription messages  */
        if (this.$.mode === "websocket") {
            let onNotify = Chunking({
                reset: (ctx) => {
                    ctx.sids = new OSet()
                },
                absorb: (ctx, sids) => {
                    sids.forEach((sid) => ctx.sids.add(sid))
                },
                emit: (ctx) => {
                    /*  received notification message about outdated subscriptions  */
                    let sids = ctx.sids.values()
                    sids.forEach((sid) => {
                        if (this._.subscriptions[sid] !== undefined) {
                            this.debug(2, `refetch query of subscription ${sid} ` +
                                `(instances: ${Object.keys(this._.subscriptions[sid]).length})`)
                            Object.keys(this._.subscriptions[sid]).forEach((iid) => {
                                this._.subscriptions[sid][iid].refetch()
                            })
                        }
                    })
                },
                delay: this.$.throttle
            })
            this._.graphqlLinkNet.on("receive", ({ type, data }) => {
                if (type === "GRAPHQL-NOTIFY" && Ducky.validate(data, "[ string* ]")) {
                    this.debug(1, `GraphQL notification for subscriptions: ${data.join(", ")}`)
                    onNotify(data)
                }
            })
        }

        /*  refetch active subscriptions on open/close messages  */
        if (this.$.mode === "websocket") {
            this._.graphqlLinkNet.on("open", () => {
                Object.keys(this._.subscriptions).forEach((sid) => {
                    this.debug(2, `refetch query of subscription ${sid} ` +
                        `(instances: ${Object.keys(this._.subscriptions[sid]).length})`)
                    Object.keys(this._.subscriptions[sid]).forEach((iid) => {
                        this._.subscriptions[sid][iid].reset()
                        this._.subscriptions[sid][iid].refetch(true)
                    })
                })
            })
        }

        /*  perform an initial connect  */
        if (this.$.mode === "websocket")
            await this._.graphqlLinkNet.connect()

        return this
    }

    /*  disconnect from the backend endpoints  */
    async disconnect () {
        /*  perform a final disconnect  */
        this.debug(2, "disconnect from backend")
        if (this.$.mode === "websocket")
            await this._.graphqlLinkNet.disconnect()

        /*  cleanup  */
        this._.graphqlClient  = null
        this._.graphqlCache   = null
        this._.graphqlLinkErr = null
        this._.graphqlLinkNet = null
        return this
    }

    /*  perform a login  */
    async login (implicit = false) {
        this.debug(2, `login at backend (${implicit ? "implicitly" : "explicitly"})`)

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

            /*  for WebSocket connections, force a re-establishment
                as the server has to be forced to authenticate us again  */
            if (this.$.mode === "websocket") {
                await this._.graphqlLinkNet.disconnect()
                await this._.graphqlLinkNet.connect()
            }
            return true
        }, (err) => {
            this.error(`login failed: ${err}`)
            return false
        })
    }

    /*  perform a logout  */
    logout (implicit = false) {
        this.debug(2, `logout at backend (${implicit ? "implicitly" : "explicitly"})`)
        return Axios.get(`${this.$.url}${this.$.path.logout}`).then(() => {
            this._.loginUsername = null
            this._.loginPassword = null
            this._.token         = null
            this._.peer          = null
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

    /*  query (internal API)  */
    _graphql (type, query, vars = {}, opts = {}) {
        /*  sanity check options  */
        let err = []
        if (!Ducky.validate(opts, `{
            errorsEmit?: boolean,
            errorsPass?: boolean,
            dataStrict?: boolean,
            dataRequire?: string
        }`, err))
            throw new Error(`invalid options: ${err.join("; ")}`)

        /*  provide defaults for options  */
        opts = Object.assign({}, {
            errorsEmit:  true,
            errorsPass:  true,
            dataStrict:  false,
            dataRequire: null
        }, opts)

        /*  optionally compile data requirement specification  */
        if (opts.dataRequire !== null) {
            try {
                opts.dataRequire = Ducky.validate.compile(opts.dataRequire)
            }
            catch (ex) {
                throw new Error(`invalid dataRequire option: ${ex}`)
            }
        }

        /*  provide a smart intermediate error handler  */
        const onError = (err) => {
            if (typeof err === "object"
                && err !== null
                && typeof err.path === "object"
                && err.path !== null
                && err.path instanceof Array
                && typeof err.message === "string")
                err = `GraphQL error at path ${err.path.join(".")}: ${err.message}`
            else if (typeof err === "object"
                && err !== null
                && typeof err.message === "string")
                err = err.message
            else
                err = err.toString()
            err = err.replace(/(?:\s|\r?\n)+/g, " ")
            if (opts.errorsEmit)
                this.error(err)
        }

        /*  create and return a new query object  */
        return new Query(this, onError, type, query, vars, opts)
    }

    /*  query (official API)  */
    graphql  (...args) { return this._graphql("", ...args) }
    query    (...args) { return this._graphql("query", ...args) }
    mutation (...args) { return this._graphql("mutation", ...args) }

    /*  fetch  */
    fetch (name) {
        this.debug(2, `fetching BLOB "${name}"`)
        return Axios.get(`${this.$.url}${this.$.path.blob}/${name}`).then((data) => {
            return data
        }, (err) => {
            this.error(`fetching of BLOB "${name}" failed: ${err}`)
            return null
        })
    }
}

