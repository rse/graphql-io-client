
const { Client } = require("graphql-io-client")

;(async () => {
    const sv = new Client({ url: "http://127.0.0.1:12345/api", debug: 0 })
    sv.on("debug", ({ log }) => console.log(log))
    await sv.connect()
    let result = await sv.query("{ hello }")
    console.log(result.data)
    await sv.disconnect()
})()

