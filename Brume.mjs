export { Brume };

import { encodeMsg, decodeMsg, checkMsgType } from './peerMsgEncDec.mjs';
import { log } from './logger.mjs';
import { EventEmitter } from './events.mjs';

let refreshTokenAuth = () => {}; // webpack needs this but only called in nodejs
let /*wrtc,*/ SimplePeer;

/// #if WEBPACK

// webview
// #code SimplePeer = ( await import( './simplepeer.min.js' ) ).default;

/// #else

if( typeof window !== 'undefined' ){
	// browser
	await import( './simplepeer.min.js' );
	SimplePeer = window.SimplePeer;
} else {
	// nodejs
	( { refreshTokenAuth } = await import( 'brume-auth' ) );
	SimplePeer = ( await import( 'simple-peer' ) ).default;
	//global.WebSocket = ( await import( 'ws' ) ).default;
}

/// #endif

const jwt = { decode( t ){ return JSON.parse( atob( t.split( '.' )[1] ) ); } };
const OFFERTIMEOUT = 5 * 60 * 1000; // 5 minutes

function arrayClone( arr, n ) {
	var copy = new Array( n );
	for ( var i = 0; i < n; ++i )
		copy[i] = arr[i];
	return copy;
}

SimplePeer.prototype.emit = function emit( type ) {
	var args = [];
	for ( var i = 1; i < arguments.length; i++ ) args.push( arguments[i] );
	var doError = ( type === 'error' );

	var events = this._events;
	if ( events !== undefined )
		doError = ( doError && events.error === undefined );
	else if ( !doError )
		return false;

	// If there is no 'error' event listener then throw.
	if ( doError ) {
		var er;
		if ( args.length > 0 )
			er = args[0];
		if ( er instanceof Error ) {
			// Note: The comments on the `throw` lines are intentional, they show
			// up in Node's output if this results in an unhandled exception.
			throw er; // Unhandled 'error' event
		}
		// At least give some kind of context to the user
		var err = new Error( 'Unhandled error.' + ( er ? ' (' + er.message + ')' : '' ) );
		err.context = er;
		throw err; // Unhandled 'error' event
	}

	var handler = events[type];

	if ( handler === undefined )
		return false;

	if ( typeof handler === 'function' ) {
		handler.apply( this, args );
	} else {
		var len = handler.length;
		var listeners = handler.slice( 0, len ); //arrayClone( handler, len );
		for( var i = 0; i < len; ++i )
			if( listeners[i].apply( this, args ) === 'stopImmediatePropagation' ) break;
	}

	return true;
};

const	CLIENTID = '6dspdoqn9q00f0v42c12qvkh5l',
	errorCodeMessages = {
		400: 'Missing token',
		401: 'Unauthorized',
		402: 'Payment required',
		403: 'Invalid server url',
		404: 'This user is unknown',
		406: 'Bad token',
		409: 'This user is already connected',
		410: 'Payment required',
		500: 'Server error',
		501: 'Server error',
		EBADCONFIG: 'Invalid service config',
		ECONNREFUSED: '',
		ENOSRV: 'No server connection',
		ENOTFOUND: '',
		ENODEST: '',
		EOFFERTIMEOUT: '',
		NotAuthorizedException: 'Invalid Refresh Token'
	};

function wsConnect( { token, url } ) {
	return new Promise( ( res, rej ) => {
		let ws = typeof window == undefined
			? new WebSocket( url, { headers: { token }, rejectUnauthorized: false } )
			: new WebSocket( `${ url }?token=${ token }` );

		//ws.on('pong', ()=>{});
		ws.onopen = () => { res( ws ); };

		ws.onerror = err => {
			// make codes recognize: ECONNREFUSED, ENOTFOUND in err.message
			const code = err?.message
				? err?.message.match( /: (\d*)/ )
					? err.message.match( /: (\d*)/ )[1]
					: undefined
				: undefined;
			rej( code && errorCodeMessages[code] ? { message: `${ errorCodeMessages[code] } ${ code }`, code } : err );
		};

	} );
}

function setPingInterval( ws ){
	return typeof ws?.ping === 'function'
		? setInterval( function(){ ws.ping( ()=>{} ); }, 9.8 * 60 * 1000 )
		: null;
}

function ondataHandler ( _data ) {
	if( checkMsgType( _data, 'signal' ) ){
		const data = decodeMsg( _data );
		if( data?.type === 'signal' ){
			log.debug( `peer signal: ${ data.data.type }` );
			switch( data.data.type ){
				case 'offer':
				case 'answer':
				case 'candidate':
				case 'renegotiate':
					this.signal( data.data );
					break;

				case 'transceiverRequest':
					this.addTransceiver( data.data.transceiverRequest.kind, { send: true, receive: true } );
					break;

				case 'peerError':
					this.emit( 'peerError', data.data );
					break;

				default:
					log.debug( `Unknown message: ${ JSON.stringify( data.data, null, 2 ) }` );
			}
			return 'stopImmediatePropagation';
		}
	}
}

class Brume extends EventEmitter {
	static log = log;
	static encodeMsg = encodeMsg;
	static decodeMsg = decodeMsg;
	#user = undefined;
	#ws = undefined;
	#wrtc = undefined;
	#config = undefined;
	#peers = {};
	#offerProcessor = () => {};

	constructor( { wrtc, WebSocket } = { wrtc: undefined, WebSocket: undefined } ){
		super();
		if( typeof window === 'undefined' ){
			if( typeof wrtc === 'undefined' || typeof WebSocket === 'undefined' ){
				throw( `Brume constructor requires wrtc and ws in nodejs` );
			}
			this.#wrtc = wrtc;
			global.WebSocket = WebSocket;
		}
	}

	async #openWs( { token, url } ){
		this.#ws = await wsConnect( { token, url } );
		const pingInterval = setPingInterval( this.#ws );
		this.#ws.addEventListener( 'message',  msg => {
			let { from, ...data } = JSON.parse( msg.data );
			data = data?.data ? data.data  : data ;

			log.debug( `ws.onMessage: ${ data.type };` );
			switch( data.type ){
				case 'offer':
					if( this.#peers[ from ] !== undefined ){
						// offer because of peer renegotiate
						this.#peers[ from ].signal( data );
					} else {
						const peer = new SimplePeer( { trickle: true, ...( typeof this.#wrtc != 'undefined' ? { wrtc: this.#wrtc } : {} ) } );
						peer.peerUsername = from;
						this.#peers[ from ] = peer;
						peer.on( 'data', ondataHandler );
						peer.on( 'close', () => {
							delete this.#peers[ from ];
						} );
						peer.on( 'error', ( e ) => { if( !e.message.includes( 'Close called' ) ) log.debug( e.message ); } );
						peer.on( 'signal', data => {
							log.debug( `brume signal: ${ data.type }` );
							this.#ws.send( JSON.stringify( { action: 'send', to: from, data } ) );
						} );
						this.#offerProcessor( {
							peer,
							accept(){
								peer.signal( data );
								return new Promise( res => { peer.on( 'connect', function(){
									peer.removeAllListeners( 'signal' );
									peer.on( 'signal', ( data ) => {
										peer.send( encodeMsg( { type: 'signal', data } ) );
									} );
									log.debug( `peer.onConnect: ${ from }` );
									res();
								} ); } );
							}
						} );
					}
					break;

				case 'answer':
					clearTimeout( this.#peers[ from ]?.offerTimer );
				case 'candidate':
				case 'renegotiate':
				  if( this.#peers[ from ] ) {
						this.#peers[ from ].signal( data );
					} else {
						log.debug( `${ data.type } received before peer created` );
					}
					break;

				case 'transceiverRequest':
					log.debug( `Brume transceiverRequest: ${ JSON.stringify( data ) }` );
					this.#peers[ from ].addTransceiver( data.transceiverRequest.kind, { send: true, receive: true } );
					break;

				case 'peerError':
					log.debug( `Brume peerError: ${ JSON.stringify( data ) }` );
					this.#peers[ data.peerUsername ].emit( 'peerError', data );
					break;

				default:
					log.debug( `Brume unknown message: ${ JSON.stringify( data, null, 2 ) }` );
			}
		} );

		this.#ws.addEventListener( 'close', ( event ) => {
			//if( typeof window === 'undefined' ){
			if( this.listeners( 'serverclose' ).length == 0 ) {
				setTimeout( async ()=>{ await this.start(); }, 10 * 1000 );  //give server time to delete closed session
			} else {
				this.emit( 'serverclose' );
			}

			clearInterval( pingInterval );
			this.stop();
		} );
	};

	get thisUser() { return this.#user; }
	set onconnection( func ){ this.#offerProcessor = func; }

	async connect( to ){
		if( this.#ws === undefined ){
			return Promise.reject( { code: 'ENOSRV', message: errorCodeMessages[ 'ENOSRV' ] } );
		}

		if( this.#peers[ to ] !== undefined ){
			return Promise.resolve( this.#peers[ to ] );
		}

		const peer = new SimplePeer( { initiator: true, trickle: true, ...( typeof this.#wrtc != 'undefined' ? { wrtc: this.#wrtc } : {} ) } );
		peer.peerUsername = to;
		this.#peers[ to ] = peer;
		peer.on( 'data', ondataHandler );
		peer.on( 'close', () => {
			delete this.#peers[ to ];
		} );
		try{
			return await new Promise( ( res, rej ) => {
				peer.on( 'signal', data => {
					peer.offerTimer = setTimeout( () => {
						peer.emit( 'peerError', { code: "EOFFERTIMEOUT", peerUsername: to } );
						delete this.#peers[ to ];
					}, OFFERTIMEOUT );
					this.#ws.send( JSON.stringify( { action: 'send', to, data } ) );
				} );

				peer.on( 'connect', () => {
					log.debug( `peer.connect: ${ to }` );
					peer.removeAllListeners( 'signal' );
					peer.on( 'signal', ( data ) => {
						peer.send( encodeMsg( { type: 'signal', data } ) );
					} );
					res( peer );
				} );
				peer.on( 'error', ( e ) => { rej( e ); } );
				peer.on( 'peerError', ( { code, peerUsername: to } ) => {
					clearTimeout( peer.offerTimer );
					delete this.#peers[ to ];
					rej( { code: code, peerUsername: to, type: 'peerError', message: `${ to } connection request timeout` } );
				} );
			} );
		} catch( e ) {
			throw( e );
		}
	};

	start( config ){
		if( config?.token === undefined || config?.url === undefined ){
			return Promise.reject( { code: 'EBADCONFIG', message: errorCodeMessages[ 'EBADCONFIG' ] } );
		}

		this.#config = config;
		this.#user = jwt.decode( config?.token )['custom:brume_name'];

		return new Promise( async ( res, rej ) => {
			try {
				await this.#openWs( { token: config?.token, url: config?.url } );
				res();
			} catch( e ) {
				if( typeof window === 'undefined' && e?.code && e.code == '401' ){
					try{
						let { IdToken } = await refreshTokenAuth( CLIENTID, this.#config.RefreshToken );
						this.#config.token = IdToken;
						this.emit( 'reauthorize', this.#config );
						await this.#openWs( { token: this.#config.token, url: this.#config.url } );
						res( this );
					} catch( e ) {
						rej( e );
					}
				} else {
					rej( e );
				}
			}
		} );
	}

	stop(){ this.#ws = undefined; }
}
