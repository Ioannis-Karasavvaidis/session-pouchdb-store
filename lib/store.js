// module.exports = SessionStore;
const {
	Store
} = require('express-session');
const PouchDB = require('pouchdb');
const PouchDBMemory = require('pouchdb-adapter-memory');

PouchDB.plugin(PouchDBMemory);
PouchDB.plugin(require('pouchdb-upsert'));

/**
 * Default Store options
 * @type {Object}
 */
const DEF_OPTS = {
	maxIdle: 5 * 60 * 1000, // Max idle time in ms
	scavenge: 1000, // Scavenge period in ms
	purge: 5 * 60 * 1000, // Database purge period in ms
};

function instance(pouchDB) {
	if (typeof pouchDB === 'string') return new PouchDB(pouchDB);
	else if (pouchDB instanceof PouchDB) return pouchDB;
	else if (typeof pouchDB === 'object') return new PouchDB(pouchDB);
	return new PouchDB('sessions', {
		adapter: 'memory',
	});
}

/**
 * PouchDB express session store.
 * @class
 * @extends Store
 */
class SessionStore extends Store {
	/**
	 * Constructor
	 * @param {PouchDB} pouchDB A PouchDB instance, and initialization PouchDB
	 * options object, or a remote PouchDB/CouchDB url string.
	 * @param {mixed} options Configuration options
	 */
	constructor(pouchDB, options = {}) {
		super();
		this.pouch = instance(pouchDB);
		this.sessions = {};
		this.options = Object.assign(DEF_OPTS, options);
		this._subscribe(); //eslint-disable-line
		this._timers(); //eslint-disable-line
	}

	/**
	 * Starts the purge and scavenge timers.
	 * @ignore
	 */
	_timers() {
		const opt = this.options;

		setInterval(() => {
			const now = Date.now();
			Object.keys(this.sessions).forEach(sid => {
				const sess = this.sessions[sid];
				if (now - sess.$ts > opt.maxIdle) {
					delete this.sessions[sid];
				}
			});
		}, opt.scavenge);
	}

	/**
	 * Subscribe to PouchDB changes, so we can keep real-time synched
	 * versions of the sessions.
	 * @ignore
	 */
	_subscribe() {
		this.pouch
			.changes({
				since: 'now',
				live: true,
				include_docs: true,
			})
			.on('change', change => {
				const id = change.doc._id; //eslint-disable-line
				let old = this.sessions[id];
				if (old && change.doc) old = Object.assign(old, change.doc);
			})
			.on('complete', info => {
				console.error('COMPLETE', info);
			})
			.on('error', err => {
				console.error('ERROR', err);
			});
	}

	/**
	 * Retrieve all stored sessions
	 * @param  {Function} callback Callback function (err,sessions)
	 */
	async all(callback) {
		try {
			const allDocs = await this.pouch.allDocs({
				include_docs: true,
				attachments: true,
			});

			callback(null, allDocs.rows.map(row => row.doc));
		} catch (e) {
			callback(e);
		}
	}

	/**
	 * Destroys a session
	 * @param  {string} sid Session ID
	 * @param  {Function} callback Callback function (err,sessions)
	 */
	destroy(sid, callback) {
		this.get(sid, async (err, doc) => {
			if (err) callback(err);
			else {
				delete this.sessions[sid];
				try {
					await this.pouch.remove(doc);
					callback();
				} catch (e) {
					callback(e);
				}
			}
		});
	}

	/**
	 * Clears all the session storage
	 * @param  {Function} callback Callback function (err)
	 */
	async clear(callback) {
		try {
			const allDocs = await this.pouch.allDocs({
				include_docs: true,
			});
			await this.pouch.bulkDocs(
				allDocs.rows.map(row => ({
					_id: row.id,
					_rev: row.doc._rev, //eslint-disable-line
					_deleted: true,
				})),
			);
			callback();
		} catch (e) {
			callback(e);
		}
	}

	/**
	 * Returns the number of current stored sessions
	 * @param  {Function} callback Callback function (err,length)
	 */
	async length(callback) {
		try {
			const allDocs = await this.pouch.allDocs({
				include_docs: false,
			});
			callback(null, allDocs.rows.length);
		} catch (err) {
			callback(err);
		}
	}

	/**
	 * Retrieve a session by its session ID
	 * @param  {string}   sid      Session ID
	 * @param  {Function} callback Callback function (err,session)
	 */
	async get(sid, callback) {
		if (this.sessions[sid]) {
			callback(null, this.sessions[sid]);
		} else {
			try {
				const sess = await this.pouch.get(sid, {
					attachments: true,
				});
				callback(null, sess);
			} catch (err) {
				if (err.status === 404) callback();
				else callback(err);
			}
		}
	}

	/**
	 * Saves a session to the store
	 * @param {string}   sid      	Session ID
	 * @param {Session}  session  	Session to store
	 * @param {Function} callback 	Callback function (err,session)
	 */
	async set(sid, session, callback) {
		if (!session._id) session._id = sid; //eslint-disable-line
		session.$ts = Date.now(); //eslint-disable-line
		try {
			this.sessions[sid] = Object.assign(this.sessions[sid] || {}, session);
			await this.pouch.put(this.sessions[sid]);
			callback();
		} catch (err) {
			callback(err);
		}
	}

	/**
	 * Keeps alive a session (maxIdle timer)
	 * @param  {string}   sid      Session ID
	 * @param  {Session}  session  Session to refresh
	 * @param  {Function} callback Callback function (err)
	 */
	async touch(sid, session, callback) {
		try {
			const oldSession = this.sessions[sid] || (await this.pouch.get(sid));
			if (Date.now() - oldSession.$ts > 1000) {
				this.sessions[sid] = oldSession;
				try {
					await this.set(sid, oldSession, callback);
					callback();
				} catch (e) {
					callback(e);
				}
			} else {
				callback();
			}
		} catch (e) {
			callback(e);
		}
	}
}

module.exports = SessionStore;