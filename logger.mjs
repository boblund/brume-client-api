export { log };

function basename( path ){ return path.split('/').reverse()[0]; };

const levels = [ 'DEBUG', 'INFO', 'WARN', 'ERROR' ];
let level = typeof window === 'undefined'
	? ( process.env?.LOG ? process.env.LOG : 'INFO' )
	: ( localStorage?.LOG ? localStorage?.LOG : 'INFO' );

const _log = a => ( ...b ) => {
	if( levels.indexOf( a ) > -1 && levels.indexOf( a ) >=  level ) {
		//const location = new Error().stack.split('\n')[3].match(/(at \S*).*\/(\S*)\)/)
		const lineNumber = level === 'DEBUG' ? basename( new Error().stack.split('\n')[3].slice(0,-1) )
			.replace(/:\d+$/,'') : '';
		console.log( `${ new Date().toLocaleString( 'sv-SE' ) } [ ${ a } ] ${ lineNumber } ${ b.join( ' ' ) }` );
	}
};

const log = {
	debug( ...args ) { _log( 'DEBUG' )( ...args ); },
	info( ...args ) { _log( 'INFO' )( ...args ); },
	warn( ...args ) { _log( 'WARN' )( ...args ); },
	error( ...args ) { _log( 'ERROR' )( ...args ); },
	setLevel( l ){
		level = levels.indexOf( l ) > -1
			? levels.indexOf( l )
			: 1;
	}
};
