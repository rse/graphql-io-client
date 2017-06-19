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

/*  the Subscription class  */
export default class Subscription {
    constructor (query) {
        /*  define internal state  */
        Object.defineProperty(this, "_", {
            configurable: false,
            enumerable:   false,
            writable:     false,
            value:        {}
        })

        /*  remember internal state  */
        this._.query       = query
        this._.state       = "subscribed"
        this._.sid         = ""
        this._.unsubscribe = null
        this._.next        = null
    }

    /*  pause subscription  */
    pause () {
        if (this._.state !== "subscribed")
            throw new Error(`query not active (currently in "${this._.state}" state)`)
        return (this._.next = this._.next.then(() => {
            return this._.query._.api.query(`mutation ($sid: UUID!) {
                Subscription { pause(sid: $sid) }
            }`, { sid: this._.sid }).then(() => {
                this._.state = "paused"
                return true
            })
        }))
    }

    /*  resume subscription  */
    resume () {
        if (this._.state !== "paused")
            throw new Error(`query not paused (currently in "${this._.state}" state)`)
        return (this._.next = this._.next.then(() => {
            return this._.query._.api.query(`mutation ($sid: UUID!) {
                Subscription { resume(sid: $sid) }
            }`, { sid: this._.sid }).then(() => {
                this._.state = "subscribed"
                return true
            })
        }))
    }

    /*  undo subscription  */
    unsubscribe () {
        if (this._.state === "unsubscribed")
            throw new Error("query already unsubscribed")
        return (this._.next = this._.next.then(() => {
            return this._.query._.api.query(`mutation ($sid: UUID!) {
                Subscription { unsubscribe(sid: $sid) }
            }`, { sid: this._.sid }).then(() => {
                delete this._.query._.api._.subscriptions[this._.sid]
                if (this._.unsubscribe !== null)
                    this._.unsubscribe.unsubscribe()
                this._.state = "unsubscribed"
                return true
            })
        }))
    }
}

