(async () => {

    /*  Hello World Client  */
    const { Client } = require("graphql-io-client")
    const sv = new Client({ url: "http://127.0.0.1:12345/api" })
    sv.on("debug", ({ log }) => console.log(log))
    await sv.connect()
    let name = process.argv[2]
    let result = await sv.query(name ? `{ hello(name: "${name}") }` : "{ hello }")
    console.log(result.data)
    await sv.disconnect()

})().catch((err) => {
    console.log("ERROR", err)
})
