#!/usr/bin/env node
import Hyperschema from 'hyperschema'
import HyperdbBuilder from 'hyperdb/builder'
import Hyperdispatch from 'hyperdispatch'
import { extendSchema, extendDb, extendDispatch } from 'autobonk'

const specRoot = './spec'
const schemaDir = specRoot + '/schema'
const dbDir = specRoot + '/db'
const dispatchDir = specRoot + '/dispatch'

const schema = Hyperschema.from(schemaDir)
extendSchema(schema)

const facebonk = schema.namespace('facebonk')

facebonk.register({
  name: 'profile',
  compact: false,
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'displayName', type: 'string', required: false },
    { name: 'bio', type: 'string', required: false },
    { name: 'updatedAt', type: 'uint', required: true }
  ]
})

facebonk.register({
  name: 'profile-set',
  compact: false,
  fields: [
    { name: 'displayName', type: 'string', required: false },
    { name: 'bio', type: 'string', required: false },
    { name: 'clearDisplayName', type: 'bool', required: false },
    { name: 'clearBio', type: 'bool', required: false },
    { name: 'updatedAt', type: 'uint', required: true }
  ]
})

Hyperschema.toDisk(schema)

const dbBuilder = HyperdbBuilder.from(schemaDir, dbDir)
extendDb(dbBuilder)

const db = dbBuilder.namespace('facebonk')

db.collections.register({
  name: 'profiles',
  schema: '@facebonk/profile',
  key: ['id']
})

HyperdbBuilder.toDisk(dbBuilder)

const dispatch = Hyperdispatch.from(schemaDir, dispatchDir)
extendDispatch(dispatch)

const facebonkDispatch = dispatch.namespace('facebonk')

facebonkDispatch.register({
  name: 'profile-set',
  requestType: '@facebonk/profile-set'
})

Hyperdispatch.toDisk(dispatch)
