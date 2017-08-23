import elasticsearch from "elasticsearch"

const conf = {
  host: process.env.ES_URL || `http://localhost:9200`,
  log: process.env.ES_LOG_LEVEL || `trace`
}
if (process.env.ES_PASSWORD) {
  // Use authentication
  const username = process.env.ES_USERNAME || `elastic`
  conf.httpAuth = `${username}:${process.env.ES_PASSWORD}`
}

export default new elasticsearch.Client(conf)