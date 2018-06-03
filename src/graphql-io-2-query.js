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
import Ducky        from "ducky"

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
        this._.ast   = null
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

    /*  compile GraphQL query AST  */
    __compileAST () {
        /*  convert GraphQL query from string to AST  */
        try {
            this._.ast = gql`${this._.query}`
        }
        catch (err) {
            return err
        }
        return null
    }

    /*  assemble Apollo Client query/mutation arguments  */
    __assembleArgs (opts = {}) {
        /*  determine type of operation  */
        let kind = this._.type === "mutation" ? "mutation" : "query"

        /*  assemble arguments  */
        return Object.assign({}, {
            [ kind ]:    this._.ast,
            variables:   this._.vars,
            fetchPolicy: this._.type === "mutation" ? "no-cache" : "network-only",
            errorPolicy: "all"
        }, opts)
    }

    /*  process Apollo Client result object  */
    __processResults (result, onResult, info = "") {
        /*  determine whether there is any data and/or errors  */
        let anyData   = !!(result.data)
        let anyErrors = !!(result.errors)

        /*  optionally perform data structure validation  */
        if (this._.opts.dataRequire !== null) {
            let errors = []
            if (!Ducky.validate.execute(result.data, this._.opts.dataRequire, errors)) {
                if (!anyErrors) {
                    result.errors = []
                    anyErrors = true
                }
                errors.forEach((error) => {
                    result.errors.push({ message: error })
                })
            }
        }

        /*  optionally emit errors  */
        if (   typeof result.errors === "object"
            && result.errors instanceof Array
            && result.errors.length > 0         ) {
            this._.api.debug(1, `GraphQL response (error): ${JSON.stringify(result)}${info}`)
            this._.error(result.errors[0])
        }
        else
            this._.api.debug(1, `GraphQL response (success): ${JSON.stringify(result)}${info}`)

        /*  optionally enforce strict data  */
        if (anyData && anyErrors && this._.opts.dataStrict) {
            result.data = null
            anyData = false
        }

        /*  optionally do not pass-through errors  */
        if (anyErrors && !this._.opts.errorsPass) {
            delete result.errors
            anyErrors = false
        }

        /*  cleanup result data from Apollo Client's injected symbols  */
        if (result.data !== null && typeof Object.getOwnPropertySymbols === "function") {
            const traverse = (obj) => {
                if (typeof obj === "object" && obj !== null) {
                    let symbols = Object.getOwnPropertySymbols(obj)
                    symbols.forEach((symbol) => { delete obj[symbol] })
                    let properties = Object.keys(obj)
                    properties.forEach((property) => { traverse(obj[property]) })
                }
            }
            traverse(result.data)
        }

        /*  process results only if there is (still) any data and/or errors  */
        if (anyData || anyErrors)
            result = onResult(result)

        return result
    }

    /*  configure ONE-TIME callback
        (NOTICE: we accept Promise-like onResult/onError arguments, but ignore onError and
                 always return a valid to-be-resolved Promise for async/await usage by caller)  */
    then (onResult /*, onError */) {
        /*  sanity check usage  */
        if (typeof onResult !== "function")
            throw new Error("you have to supply a result function")

        /*  compile GraphQL query  */
        let err = this.__compileAST()
        if (err !== null) {
            this._.error(err)
            return new Promise((resolve /* , reject */) => {
                resolve(onResult({ data: null, errors: [ err ] }))
            })
        }

        /*  create a request with the underlying Apollo Client query/mutate method  */
        let method = (this._.type === "query" ? "query" : "mutate")
        this._.api.debug(1, `GraphQL request (${method}): ` +
            `query: ${JSON.stringify(this._.query)}, ` +
            `variables: ${JSON.stringify(this._.vars)}`)
        let args = this.__assembleArgs()
        let promise = this._.api._.graphqlClient[method](args)

        /*  post-process the result  */
        promise = promise.then((result) => {
            return clone(result, false)
        }, (error) => {
            if (!(error instanceof Error))
                error = new Error(error)
            return { data: null, errors: [ error ] }
        }).then((result) => {
            return this.__processResults(result, onResult)
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

        /*  compile GraphQL query  */
        let err = this.__compileAST()
        if (err !== null) {
            this._.error(err)
            onResult({ data: null, errors: [ err ] })
            return
        }

        /*  create a Subscription around the Apollo Client query method  */
        this._.api.debug(1, "GraphQL request (query): " +
            `query: ${JSON.stringify(this._.query)}, ` +
            `variables: ${JSON.stringify(this._.vars)}`)
        let subscription = new Subscription(this, onResult)
        subscription.refetch()
        return subscription
    }
}

