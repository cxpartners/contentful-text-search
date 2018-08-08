const debug = require(`debug`)(`contentful-wrapper`)
const createContentfulClient = require(`contentful`).createClient
const fs = require('fs')

module.exports = class ContentfulSyncWrapper {
  constructor({ space, token, contentfulHost, contentType }) {
    if (!space || !token) {
      throw new Error(`'space' and 'token' parameters are required`)
    }
    this.client = createContentfulClient({
      space,
      accessToken: token,
      resolveLinks: false,
      host: contentfulHost || `cdn.contentful.com`,
    })
    this.syncToken = false,
    this.lastResolvedContent = {
      content: false,
      resolved: false,
    }
    this.contentType = contentType
  }

  // Sugar function to get and resolve entries with one call
  async getResolvedEntries() {
    const entries = await this.getEntries()
    return this.resolveReferences(entries)
  }

  // Get all entries from cache (making sure cache is up to date via syncing first)
  async getEntries() {
    debug(`Getting entries`)
    try {
      const { entries, deletedEntries } = await this.sync()
      debug(`Entries`)
      debug(entries)
      return entries
    } catch (err) {
      debug(`Error getting entries: %s`, err)
      return []
      throw new Error(err)
    }
  }

  // Called before geting data from CF, ensures cache is up to date
  async sync() {
    debug(`Syncing`)
    try {
      // Filter by entries only on initial sync since later syncs don't support it
      if (this.syncToken) {
        debug(`Sync token found, syncing content from ${this.syncToken}`)
      }
      let query = this.syncToken
        ? { nextSyncToken: this.syncToken }
        : { initial: true, type: `Entry`, content_type: this.contentType }
      query.resolveLinks = false
      const clientSyncResponse = await this.client.sync(query)

      if (clientSyncResponse.nextSyncToken === this.syncToken) {
        debug(`No updates since last sync`)
        return Promise.resolve()
      }

      debug(`Sync updates found, updating cache...`)
      debug(`Current syncToken`, this.syncToken)
      debug(`syncToken set to`, clientSyncResponse.nextSyncToken)
      this.syncToken = clientSyncResponse.nextSyncToken
      await this.setSyncToken()
      return clientSyncResponse
//       // Use promise.all so these execute in parallel
//       await Promise.all([
//         this.db.storeEntries(entries),
//         this.db.removeEntries(deletedEntries),
//       ])
//       return Promise.resolve()
    } catch (err) {
      debug(`Error syncing contentful: %s`, err)
      throw new Error(err)
    }
  }

  // Resolve references to other entries in an array of contentful entries, and group fields by locale
  async resolveReferences(entries) {
    try {
      const stringifiedContent = JSON.stringify(entries)
      // If we already resolved links for this content, return the stored data
      if (this.lastResolvedContent.content === stringifiedContent) {
        debug(`Resolved entries found in cache`)
        return this.lastResolvedContent.resolved
      }

      debug(`Resolving entries...`)
      const entriesMap = this.createEntriesMap(entries)
      const resolvedEntries = this.resolve(entries, entriesMap)
      this.lastResolvedContent = {
        content: stringifiedContent,
        resolved: resolvedEntries,
      }

      debug(`Returning resolved entries`)
      return resolvedEntries
    } catch (err) {
      debug(`Failed resolving references for entries: %O`, entries)
      throw new Error(err)
    }
  }

  // create an object with content ID as keys
  createEntriesMap(entries) {
    try {
      return entries.reduce(
        (accu, entry) => Object.assign(accu, { [entry.sys.id]: entry }),
        {}
      )
    } catch (err) {
      debug(`entries: %O`, entries)
    }
  }

  // Recursive func used to resolve links
  resolve(content, entriesMap) {
    try {
      // content is an array
      if (Array.isArray(content)) {
        return content.map(x => this.resolve(x, entriesMap))
      }
      // content is an entry with fields
      if (content && content.sys && content.sys.type === `Entry`) {
        return this.groupFieldsByLocale(content, entriesMap)
      }
      // Content is a reference to another entry
      if (
        content &&
        content.sys &&
        content.sys.type === `Link` &&
        content.sys.linkType === `Entry`
      ) {
        return this.resolve(entriesMap[content.sys.id], entriesMap)
      }
      // content is a value
      return content
    } catch (err) {
      debug(`Error resolving: %s`, err)
      debug(`Could not resolve content: %O`, content)
      // Don't throw error since a missing entry is probably better than crashing the program
      return {}
    }
  }

  /*
  groups fields by locale e.g.
  original:
  const fields = {
    title: { `en_US`: `value` },
    subtitle: { `en_US`: `value`},
  }
  grouped:
  const fields = {
    `en_US`: {
      title:  `value`,
      subtitle: `value`
    }
  }
  */
  groupFieldsByLocale(entry, entriesMap) {
    try {
      const newEntry = { sys: entry.sys, fields: {} }
      Object.keys(entry.fields).forEach(fieldName => {
        const locales = Object.keys(entry.fields[fieldName])
        locales.forEach(localeName => {
          // add locale property if it doesn't exist already
          if (!newEntry.fields[localeName]) {
            newEntry.fields[localeName] = {}
          }
          newEntry.fields[localeName][fieldName] = this.resolve(
            entry.fields[fieldName][localeName],
            entriesMap
          )
        })
      })
      return newEntry
    } catch (err) {
      debug(`Error grouping fields by locale: %s`, err)
      debug(`Entry: %O`, entry)
      return entry
    }
  }

  getSyncToken() {
    try {
      if (fs.existsSync(process.cwd() + '/.contentful')) {
        debug('Content ', fs.readFileSync(process.cwd() + '/.contentful', 'utf8'))
        return fs.readFileSync(process.cwd() + '/.contentful', 'utf8')
      }
    } catch (e) {
      return false
    }
  }

  setSyncToken() {
    try {
      fs.writeFile(process.cwd() + '/.contentful', this.syncToken, 'utf-8', (err) => {
        // throws an error, you could also catch it here
        if (err) throw err;

        // success case, the file was saved
        debug('.contentful file saved!');
      });
    } catch (e) {
      debug('Couldn\'t write .contentful token to file', e)
      return false
    }
  }

}


