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

/*  The GraphQL-IO Client API consists of the primary class Client,
    and its secondary interfaces Query, Subscription and Result.  */
declare module "graphql-io-client" {
    /*  The primary API class of GraphQL-IO Client,
     *  representing the network communication client.  */
    class Client {
        /*  Construct a new GraphQL-IO Client instance.  */
        public constructor(options?: {
            /*  The base URL of the server.
                Has to match the regex `^https?:\/\/.+?:\d+\/.*$`.
                The default is `"http://127.0.0.1:8080/api"`.  */
            url: string,

            /*  The URL path specification.  */
            path: {
                /*  The relative URL path to the login service of the server.
                    Has to match the regex `^(?:|\\/.+)$`.
                    The default is `/auth/login`.  */
                login: string,

                /*  The relative URL path to the session service of the server.
                    Has to match the regex `^(?:|\\/.+)$`.
                    The default is `/auth/session`.  */
                session: string,

                /*  The relative URL path to the logout service of the server.
                    Has to match the regex `^(?:|\\/.+)$`.
                    The default is `/auth/logout`.  */
                logout: string,

                /*  The relative URL path to the GraphQL service of the server.
                    Has to match the regex `^(?:|\\/.+)$`.
                    The default is `/data/graph`.  */
                graph: string,

                /*  The relative URL path to the BLOB service of the server.
                    Has to match the regex `^(?:|\\/.+)$`.
                    The default is `/data/blob`.  */
                blob: string
            },

            /*  The unique client identifier (CID).
                Has to be a valid UUID. It is used to uniquely identify the device in the session.
                The default is an automatically generated UUID v1.  */
            cid: string,

            /*  The communication mode for the GraphQL requests.
                Has to be either `http` (maximum portability, no subscription support)
                or `websocket` (maximum performace, subscription support).
                The default is `websocket`.  */
            mode: string

            /*  The frame encoding for the GraphQL over WebSocket communication.
                Has to be either `cbor` (maximum performance, binary),
                `msgpack` (maximum performance, binary) or `json` (less performance, text, human readable).
                The default is `cbor`.  */
            encoding: string

            /*  The debugging level.
                Has to be an integer between 0 (no debugging) and 3 (maximum debugging messages).
                The default is 0. The debugging messages are emitted as the event `debug`
                and can be received with `client.on("debug", (msg) => { ... })`.  */
            debug: number
        })

        /*  Listen to an event **eventName** and let the callback **handler** be asynchronously
            called for every emitted event. Known events are `debug` (handler argument:
            `info: { date: string, level: number, msg: string, log: string })`
            and `error` (handler argument: `error: Error`).  */
        public on(eventName: string, handler: (eventData: any) => void): void

        /*  Remove a previously registered event listener **handler** under event **eventName**.  */
        public removeListener(eventName: string, handler: (eventData: any) => void): void

        /*  Latch into a hook **hookName** and let the callback **handler** be synchronously
            called for every hook processing. Known hooks are: `login-credentials` (handler argument:
            `credentials: { username: string, password: string })`.  */
        public at(hookName: string, handler: (...args: any[]) => any): void

        /*  Remove a previously registered hook latching **handler** under hook **hookName**.  */
        public removeLatching(hookName: string, handler: (...args: any[]) => any): void

        /*  Merge one or more options into the Client configuration.
            This accepts the same **options** as the constructor.
            Should be used before any call to connect().  */
        public configure(options: object): Client

        /*  Initiate a connection to the server.
            This instanciates the internal network connections.  */
        public connect(): Promise<Client>

        /*  Initiate a disconnection from the server.
            This drops the internal network connections.  */
        public disconnect(): Promise<Client>

        /*  Perform a login at the server.
            This raises the hook `login-credentials` for gathering a new username/password pair.  */
        public login(): Promise<boolean>

        /*  Perform a logout at the server.  */
        public logout(): Promise<boolean>

        /*  Determines the current session at the server.  */
        public session(): Promise<object>

        /*  Send a GraphQL **query** (with optional **variables**) to the server.
            Apollo Client **options** can be passed-through. For GraphQL query
            or query subscription, the **query** parameter can have the
            operation prefix `query` omitted. For GraphQL mutation, the **query**
            parameter has to start with the operation prefix `mutation`.  */
        public query(query: string, variables?: object, options?: object): Query
    }

    /*  The secondary interface for representing a GraphQL query or mutation
        before it is actually executed.  */
    interface Query {
        /*  Once execute the query as a regular GraphQL query or mutation.  */
        then(onResult: (result: Result) => any, onError?: (error: Error) => any): Promise<Result>

        /*  Once execute the query as a regular GraphQL query, subscribe
            for any further changes and re-execute the query again on
            each change notification received from the server.  */
        subscribe(onResult: (result: Result) => void, onError?: (error: Error) => void): Subscription
    }

    /*  The secondary interface for representing a GraphQL query subscription in order
        to pause, resume and unsubscribe it.  */
    interface Subscription {
        /*  Pause the subscription at the server.  */
        pause(): Promise<boolean>

        /*  Resume the subscription at the server.  */
        resume(): Promise<boolean>

        /* Unsubscribe the subscription at the server.  */
        unsubscribe(): Promise<boolean>
    }

    /*  The secondary interface for representing a GraphQL result object,
        containing both the result data and optionally any occurred errors.  */
    interface Result {
        data: object,
        errors?: Array<{
            message: string;
            locations?: Array<{
                line: number;
                column: number;
            }>;
            [ name: string ]: any;
        }>
    }

    const client: Client
    export = client
}

