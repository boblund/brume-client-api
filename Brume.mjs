export { Brume };
import { encodeMsg, decodeMsg } from './peerMsgEncDec.mjs';
import { log } from './logger.mjs';

const jwt = { decode( t ){ return JSON.parse( atob( t.split( '.' )[1] ) ); } };
const	errorCodeMessages = {
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
	NotAuthorizedException: 'Invalid refresh token'
};

class Brume { //extends EventEmitter {
	static log = log;
	static encodeMsg = encodeMsg;
	static decodeMsg = decodeMsg;
	#user = undefined;
	#ws = undefined;
	#config = undefined;

	constructor( { WebSocket, config } = { WebSocket: undefined, trickle: true, config: undefined } ){
		//super();
		if( typeof window === 'undefined' ){
			if( typeof WebSocket === 'undefined' ){
				throw( `Brume constructor requires ws in nodejs` );
			}
			global.WebSocket = WebSocket;
		}

		if( config ){
			this.#config = config;
			this.#user = jwt.decode( this.#config?.token )['custom:brume_name'];
		}
	}

	get thisUser() { return this.#user; }

	start( config = undefined ){
		this.#config = config === undefined ? this.#config : config;
		try{
			this.#user = jwt.decode( this.#config?.token )['custom:brume_name'];
		} catch( e ){
			return Promise.reject( { code: 'EBADCONFIG', message: errorCodeMessages[ 'EBADCONFIG' ] } );
		}

		return new Promise( ( res, rej ) => {
			const { token, url } = this.#config;
			let ws;
			try{
				ws = typeof window == undefined
					? new WebSocket( url, { headers: { token }, rejectUnauthorized: false } )
					: new WebSocket( `${ url }?token=${ token }` );
			} catch( e ){
				Brume.log.error( `new WebSocket error: ${ JSON.stringify( e ) }` );
				rej( e );
			}

			//ws.on('pong', ()=>{});
			ws.onopen = () => { res( ws ); };
			ws.onerror = err => { rej( err ); };

			const pingInterval = this.#ws?.ping instanceof Function
				? setInterval( () => { this.#ws.ping( ()=>{} ); }, 9.8 * 60 * 1000 )
				: undefined;

			ws.addEventListener( 'close', ( event ) => {
				//this.emit( 'serverclose', { code: event.code, message: event.reason } );
				clearInterval( pingInterval );
				this.stop();
			} );
		} );
	}

	stop(){ this.#ws = undefined; }
}
