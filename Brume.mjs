export { Brume };

import { encodeMsg, decodeMsg, checkMsgType } from './peerMsgEncDec.mjs';
import { log } from './logger.mjs';
import { EventEmitter } from './events.mjs';

let  SimplePeer;

/// #if WEBPACK

// #code SimplePeer = ( await import( 'simple-peer' ) ).default;

/// #else

if( typeof window !== 'undefined' ){
	// browser
	await import( './simplepeer.min.js' );
	SimplePeer = window.SimplePeer;
} else {
	// nodejs
	SimplePeer = ( await import( 'simple-peer' ) ).default;
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
		400: 'Bad signalling message',
		401: 'Unauthorized',
		402: 'Payment required',
		403: 'Invalid server url',
		404: 'This user is unknown',
		406: 'Bad token',
		409: 'This user is already connected',
		410: 'Payment required',
		500: 'Server error',
		501: 'Server error',
		EBADCONFIG: 'Invalid token',
		ECONNREFUSED: '',
		ENOSRV: 'No server connection',
		ENOTFOUND: '',
		ENODEST: 'not connected',
		EOFFERTIMEOUT: '',
		NotAuthorizedException: 'Invalid refresh token'
	};

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
	#trickle;
	#offerProcessor = () => {};

	constructor( { wrtc, WebSocket, trickle } = { wrtc: undefined, WebSocket: undefined, trickle: true } ){
		super();
		if( typeof window === 'undefined' ){
			if( typeof wrtc === 'undefined' || typeof WebSocket === 'undefined' ){
				throw( `Brume constructor requires wrtc and ws in nodejs` );
			}
			this.#wrtc = wrtc;
			global.WebSocket = WebSocket;
			this.#trickle = trickle;
		}
	}

	async #openWs( { token, url } ){
		//this.#ws = await wsConnect( { token, url } );
		this.#ws = await new Promise( ( res, rej ) => {
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

		const pingInterval = this.#ws.ping instanceof Function
			? setInterval( () => { this.#ws.ping( ()=>{} ); }, 9.8 * 60 * 1000 )
			: undefined;

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
						const peer = new SimplePeer( { trickle: this.#trickle, ...( typeof this.#wrtc != 'undefined' ? { wrtc: this.#wrtc } : {} ) } );
						peer.peerUsername = from;
						peer.myUsername = this.thisUser;
						peer.newPeer = true;
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
					this.#peers[ from ].addTransceiver( data.transceiverRequest.kind, { send: true, receive: true } );
					break;

				case 'peerError':
					if( this.#peers[ data.peerUsername ] instanceof SimplePeer ) this.#peers[ data.peerUsername ].emit( 'peerError', data );
					break;

				default:
					log.debug( `Brume unknown message: ${ JSON.stringify( data, null, 2 ) }` );
			}
		} );

		this.#ws.addEventListener( 'close', ( event ) => {
			this.emit( 'serverclose', { code: event.code, message: event.reason } );
			clearInterval( pingInterval );
			this.stop();
		} );
	};

	get thisUser() { return this.#user; }
	get serverConnected() { return this.#ws !== undefined; }
	set onconnection( func ){ this.#offerProcessor = func; }

	async connect( to ){
		if( this.#peers[ to ] !== undefined ){
			return Promise.resolve( this.#peers[ to ] );
		}

		if( this.#ws === undefined ){
			try{
				await this.start();
			} catch( e ){
				return Promise.reject( e );
			}
		}

		const peer = new SimplePeer( { initiator: true, trickle: this.#trickle, ...( typeof this.#wrtc != 'undefined' ? { wrtc: this.#wrtc } : {} ) } );
		peer.peerUsername = to;
		peer.myUsername = this.thisUser;
		peer.newPeer = true;
		this.#peers[ to ] = peer;
		peer.on( 'data', ondataHandler );
		peer.on( 'close', () => {
			delete this.#peers?.[ to ];
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
					peer.removeAllListeners( 'peerError' );
					peer.on( 'signal', ( data ) => {
						peer.send( encodeMsg( { type: 'signal', data } ) );
					} );
					res( peer );
				} );
				peer.on( 'error', ( e ) => { rej( e ); } );
				peer.on( 'peerError', ( { code, peerUsername: to } ) => {
					clearTimeout( peer.offerTimer );
					if( this.#peers[ to ] !== undefined ) this.#peers[ to ].destroy();
					delete this.#peers[ to ];
					rej( { message: `peerError: ${ to } ${ errorCodeMessages[ code ] }`, code: code } );
				} );
			} );
		} catch( e ) {
			throw( e );
		}
	};

	start( config = undefined ){
		this.#config = config === undefined ? this.#config : config;
		try{
			this.#user = jwt.decode( this.#config?.token )['custom:brume_name'];
		} catch( e ){
			return Promise.reject( { code: 'EBADCONFIG', message: errorCodeMessages[ 'EBADCONFIG' ] } );
		}

		return new Promise( async ( res, rej ) => {
			try {
				await this.#openWs( { token: this.#config.token, url: this.#config.url } );
				res();
			} catch( e ) {
				rej( e );
			}
		} );
	}

	stop(){ this.#ws = undefined; }
}
