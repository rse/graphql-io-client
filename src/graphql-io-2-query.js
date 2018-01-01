/*
**  GraphQL-IO -- GraphQL Network Communication Framework
**  Copyright (c) 2016-2018 Ralf S. Engelschall <rse@engelschall.com>
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
import clone        from "clone"
import gql          from "graphql-tag"

/*  internal dependencies  */
import Subscription from "./graphql-io-3-subscription"

/*  the Query class  */
export default class Query {
    constructor (api, error, type, query, vars, opts) {
        /*  sanity check options  */
        if (typeof api !== "object")
            throw new Error("invalid options (object expected for API argument)")
        if (typeof error !== "function")
            throw new Error("invalid options (function expected for error argument)")
        if (typeof type !== "string" || !type.match(/^(?:query|mutation|)$/))
            throw new Error("invalid options (string expected for type argument)")
        if (typeof query !== "string")
            throw new Error("invalid options (string expected for query argument)")
        if (typeof vars !== "object")
            throw new Error("invalid options (object expected for variable argument)")
        if (typeof opts !== "object")
            throw new Error("invalid options (object expected for options argument)")

        /*  define internal state  */
        Object.defineProperty(this, "_", {
            configurable: false,
            enumerable:   false,
            writable:     false,
            value:        {}
        })

        /*  remember results  */
        this._.api   = api
        this._.error = error
        this._.type  = type
        this._.query = query
        this._.vars  = vars
        this._.opts  = opts

        /*  determine and sanity check GraphQL operation type  */
        let m = this._.query.match(/^\s*(query|mutation|subscription)\b/)
        if (m !== null) {
            /*  explicit GraphQL operation given in query  */
            if (m[1] === "subscription")
                throw new Error("GraphQL \"subscription\" operation not supported " +
                    "(use subscribe() on a regular query operation instead)")
            else if (this._.type !== "" && this._.type !== m[1])
                throw new Error(`invalid GraphQL operation "${m[1]}" ` +
                    `(method ${this._.type}() requires a matching GraphQL "${this._.type}" operation)`)
            else
                this._.type = m[1]
        }
        else if (this._.type !== "")
            /*  explicit GraphQL operation NOT given in query, but implicitly given via method  */
            this._.query = `${this._.type} ${this._.query}`
        else if (this._.type === "") {
            /*  explicit GraphQL operation NOT given in query and NOT implicitly given via method  */
            this._.type  = "query"
            this._.query = `query ${this._.query}`
        }
    }

    /*  assemble Apollo Client query/mutation arguments  */
    __assembleArgs (opts = {}) {
        /*  determine type of operation  */
        let kind = this._.type === "mutation" ? "mutation" : "query"

        /*  convert query from string to AST  */
        let query
        try {
            query = gql`${this._.query}`
        }
        catch (err) {
            return err
        }

        /*  assemble arguments  */
        this._.args = Object.assign({
            [ kind ]:    query,
            variables:   this._.vars,
            fetchPolicy: "network-only",
            errorPolicy: "all"
        }, this._.opts, opts)
        return null
    }

    /*  process Apollo Client result object  */
    __processResults (result, info = "") {
        if (   typeof result.errors === "object"
            && result.errors instanceof Array
            && result.errors.length > 0         ) {
            this._.api.debug(1, `GraphQL response (error): ${JSON.stringify(result)}${info}`)
            this._.error(result.errors[0])
        }
        else
            this._.api.debug(1, `GraphQL response (success): ${JSON.stringify(result)}${info}`)
    }

    /*  configure ONE-TIME callback
        (NOTICE: we accept Promise-like onResult/onError arguments, but ignore onError and
                 always return a valid to-be-resolved Promise for async/await usage by caller)  */
    then (onResult /*, onError */) {
        /*  sanity check usage  */
        if (typeof onResult !== "function")
            throw new Error("you have to supply a result function")

        /*  assemble Apollo Client query/mutation arguments  */
        let err = this.__assembleArgs()
        if (err !== null) {
            this._.error(err)
            return new Promise((resolve /* , reject */) => {
                resolve(onResult({ data: null, errors: [ err ] }))
            })
        }

        /*  create a request with the underlying Apollo Client query/mutate method  */
        let method = (this._.type === "query" ? "query" : "mutate")
        this._.api.debug(1, `GraphQL request (${method}): ${this._.query.replace(/(?:\s|\r?\n)+/g, " ")}`)
        let promise = this._.api._.graphqlClient[method](this._.args)

        /*  post-process the result  */
        promise = promise.then((result) => {
            return clone(result, false)
        }, (error) => {
            if (!(error instanceof Error))
                error = new Error(error)
            return { data: null, errors: [ error ] }
        }).then((result) => {
            this.__processResults(result)
            return onResult(result)
        })
        return promise
    }

    /*  configure MULTI-TIME callback  */
    subscribe (onResult) {
        /*  sanity check usage  */
        if (typeof onResult !== "function")
            throw new Error("you have to supply a result function")
        if (this._.type !== "query")
            throw new Error("you can call \"subscribe\" on GraphQL query operations only")

        /*  late inject "subscribe" operation into query  */
        this._.query = this._.query.replace(/^(\s*query.*?\{)/,
            "$1 _Subscription { subscribe } ")

        /*  assemble Apollo Client watchQuery arguments  */
        let err = this.__assembleArgs({ pollInterval: 60 * 1000 })
        if (err !== null) {
            this._.error(err)
            return onResult({ data: null, errors: [ err ] })
        }

        /*  create a Subscription around the Apollo Client "watchQuery" method  */
        this._.api.debug(1, `GraphQL request (query): ${this._.query.replace(/(?:\s|\r?\n)+/g, " ")}`)
        let subscription = new Subscription(this)
        let watcher = this._.api._.graphqlClient.watchQuery(this._.args)

        subscription._.next = new Promise((resolve, reject) => {
            let first = true
            subscription._.unsubscribe = watcher.subscribe({
                next: (result) => {
                    /*  clone data structure  */
                    result = clone(result, false)

                    /*  extract subscription id from "_Subscription.subscribe" field  */
                    if (   typeof result === "object"
                        && result !== null
                        && typeof result.data === "object"
                        && result.data !== null
                        && typeof result.data._Subscription === "object"
                        && result.data._Subscription !== null
                        && typeof result.data._Subscription.subscribe === "string") {
                        subscription._.sid = result.data._Subscription.subscribe
                        this._.api._.subscriptions[subscription._.sid] = watcher
                        delete result.data._Subscription
                    }

                    /*  optionally resolve this "next" promise initially  */
                    if (first) {
                        first = false
                        resolve()
                    }

                    /*  pass-through result to outer handler  */
                    this.__processResults(result, ` <sid: ${subscription._.sid !== "" ? subscription._.sid : "none"}>`)
                    onResult(result)
                },
                error: (error) => {
                    /*  convert error into regular result  */
                    if (!(error instanceof Error))
                        error = new Error(error)
                    let result = { data: null, errors: [ error ] }
                    this.__processResults(result, ` <sid: ${subscription._.sid !== "" ? subscription._.sid : "none"}>`)
                    onResult(result)
                }
            })
        })
        return subscription
    }
}

