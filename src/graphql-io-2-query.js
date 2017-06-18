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
import clone        from "clone"
import gql          from "graphql-tag"

/*  internal dependencies  */
import Subscription from "./graphql-io-3-subscription"

/*  the Query class  */
export default class Query {
    constructor (api, error, query, vars, opts) {
        /*  sanity check options  */
        if (typeof api !== "object")
            throw new Error("invalid options (object expected for API argument)")
        if (typeof error !== "function")
            throw new Error("invalid options (function expected for error argument)")
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

        /*  determine query type  */
        this._.type = "query"
        let m = query.match(/^\s*(query|mutation|subscription)\b/)
        if (m !== null)
            this._.type = m[1]
        else
            query = `query ${query}`

        /*  optionally inject "subscribe" operation into query  */
        if (this._.type === "subscription") {
            if (!query.match(/^\s*subscription.*?\{/))
                throw new Error("subscription requires non-abbreviated GraphQL query string")
            query = query.replace(/^(\s*)subscription(.*?\{)/,
                "$1query$2 Subscription { subscribe } ")
        }

        /*  assemble Apollo Client arguments  */
        this._.api.log(1, `GraphQL query: ${query.replace(/(?:\s|\r?\n)+/g, " ")}`)
        let kind = this._.type === "mutation" ? "mutation" : "query"
        this._.args = Object.assign({
            [ kind ]:    gql`${query}`,
            variables:   vars,
            fetchPolicy: "network-only"
        }, opts)
    }

    /*  configure one-time callback  */
    then (onResult, onError) {
        /*  just return the Promise of the underlying Apollo Client query/mutate methods  */
        let promise
        if (this._.type === "query") {
            promise = this._.api._.graphql.query(this._.args)
                .then((result) => {
                    result = clone(result)
                    this._.api.log(1, `GraphQL result: ${JSON.stringify(result)}`)
                    return onResult(result)
                }, (error) => {
                    this._.api.log(1, `GraphQL error: ${JSON.stringify(error)}`)
                    return onError(error)
                })
                .catch((err) => {
                    this._.error(err)
                })
        }
        else if (this._.type === "mutation") {
            promise = this._.api._.graphql.mutate(this._.args)
                .then((result) => {
                    result = clone(result)
                    this._.api.log(1, `GraphQL result: ${JSON.stringify(result)}`)
                    return onResult(result)
                }, (error) => {
                    this._.api.log(1, `GraphQL error: ${JSON.stringify(error)}`)
                    return onError(error)
                })
                .catch((err) => {
                    this._.error(err)
                })
        }
        else if (this._.type === "subscription")
            throw new Error("you have to call \"subscribe\" on GraphQL subscription operations")
        return promise
    }

    /*  configure multiple-time callback  */
    subscribe (onResult, onError) {
        /*  create a Subscription around the Apollo Client watchQuery method  */
        if (this._.type !== "subscription")
            throw new Error("you have to call \"then\" on GraphQL query/mutation operations")
        let subscription = new Subscription(this)
        let watcher = this._.api._.graphql.watchQuery(Object.assign({}, this._.args, { pollInterval: 60 * 1000 }))
        subscription._.next = new Promise((resolve, reject) => {
            let first = true
            subscription._.unsubscribe = watcher.subscribe({
                next: (result) => {
                    /*  clone data structure  */
                    result = clone(result, false)

                    /*  extract subscription id from "Subscription.subscribe" field  */
                    if (   typeof result === "object"
                        && result !== null
                        && typeof result.data === "object"
                        && result.data !== null
                        && typeof result.data.Subscription === "object"
                        && result.data.Subscription !== null
                        && typeof result.data.Subscription.subscribe === "string") {
                        subscription._.sid = result.data.Subscription.subscribe
                        this._.api._.subscriptions[subscription._.sid] = watcher
                    }

                    /*  optionally resolve this "next" promise initially  */
                    if (first) {
                        first = false
                        resolve()
                    }

                    /*  pass-through execution to outer callback  */
                    this._.api.log(1, `GraphQL result: ${JSON.stringify(result)}`)
                    onResult(result)
                },
                error: (error) => {
                    /*  pass-through execution to outer callback  */
                    this._.api.log(1, `GraphQL error: ${JSON.stringify(error)}`)
                    if (onError)
                        onError(error)
                    else
                        this._.error(error)
                }
            })
        })
        return subscription
    }
}

