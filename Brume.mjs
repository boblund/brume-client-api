export { transferApp, transferAppCleanup };
import { Brume } from './Brume.mjs';

const transferAppDiv = document.querySelector( 'div.transfer' );
const transferDoneButton = document.querySelector( 'div.transfer span' );
const transferAppButton = document.querySelector( 'button.transfer' );
const offeredFilesDiv = document.querySelector( '#offeredFilesDiv' );
const offeredFilesList = document.querySelector( '#offeredFilesList' );
const selectButton = document.querySelector( 'button.select' );
const sendButton = document.querySelector( 'button.send' );
const acceptButton = document.querySelector( 'button.accept' );
const sendFilesDiv = document.querySelector( '#sendFilesDiv' );
const sendFilesList = document.querySelector( '#sendFilesList' );
const MAX_SEND_SIZE = 64 * 1024;

let writableStream;
let writerStartTime;
let begin = 0;
let end = MAX_SEND_SIZE;
let fileData;
let offeredFilesData = {};
let readableStream;
let readerStartTime;
let startIn = 'documents';
let sendFilesData = {};
let thisPeer;
let value = undefined;

function fileListEntry( entryName ){
	const li = document.createElement( 'li' );
	const cbEl = document.createElement( 'input' );
	cbEl.setAttribute( 'type', 'checkbox' );
	cbEl.checked = true;
	li.appendChild( cbEl );
	li.appendChild( document.createTextNode( `${ entryName }` ) );
	const progressEl = document.createElement( 'progress' );
	progressEl.max = 0;
	progressEl.value = 0;
	progressEl.hidden = true;
	li.appendChild( progressEl );
	const spanEl = document.createElement( 'span' );
	spanEl.hidden = true;
	li.appendChild( spanEl );
	return( { liEl: li, cbEl, progressEl, spanEl } );
}

async function dataHandler( _msg ) {
	let name, size, status, done;
	let	msg = Brume.decodeMsg( _msg );

	switch( msg.type ) {
		case 'offeredFiles':
			for( const file of msg.data ){
				const { liEl, cbEl, progressEl, spanEl } = fileListEntry( file );
				offeredFilesList.appendChild( liEl );
				offeredFilesData[file] = { cbEl, progressEl, spanEl };
			}
			sendFilesDiv.hidden = true;
			transferAppButton.classList.add( 'hidden' );
			transferAppDiv.classList.remove( 'hidden'  );
			offeredFilesDiv.classList.remove( 'hidden'  );
			startIn = 'downloads';
			break;

		case 'rejectedFiles':
			msg.data.forEach( file => { sendFilesData[file].cbEl.checked = false; } );
			for( const data of Object.values( sendFilesData ) ){
				if( !data.cbEl.checked ){
					delete sendFilesData[data.fileHandle.name];
				}
			}

			if( Object.keys( sendFilesData ).length > 0 ){
				fileData = Object.values( sendFilesData )[0];
				const f = await fileData.fileHandle.getFile();
				fileData.progressEl.max = f.size;
				fileData.progressEl.value = 0;
				fileData.progressEl.hidden = false;
				readableStream = f.stream().getReader();
				readerStartTime = undefined;
				thisPeer.send( Brume.encodeMsg( { type: 'start', data: { name: fileData.fileHandle.name, size: f.size } } ) );
			}
			break;

		case 'start':
			if( writableStream !== null ){
				await( new Promise( res => { setTimeout( () => { res(); }, 100 ); } ) );
			}
			( { name, size } = msg.data );
			fileData = offeredFilesData[ name ];
			writableStream = await fileData.fileHandle.createWritable();
			fileData.progressEl.max = size;
			fileData.progressEl.hidden = false;
			thisPeer.send( Brume.encodeMsg( { type: 'ready' } ) );
			writerStartTime = undefined;
			break;

		case 'chunk':
			writerStartTime = writerStartTime == undefined ? Date.now() : writerStartTime;
			const chunk = new Uint8Array( msg.data );
			await writableStream.write( chunk );
			fileData.progressEl.value += chunk.length;
			thisPeer.send( Brume.encodeMsg( { type: 'ready' } ) );
			break;

		case 'eof':
			if( fileData.progressEl.value == fileData.progressEl.max ){
				status = 'succeeded';
				fileData.spanEl.innerHTML = ` ${ ( ( fileData.progressEl.value * 8 / 1024 ) / ( ( Date.now() - writerStartTime ) / 1000 ) ).toFixed() }  Kb/s`;
			} else {
				status = `Transfer failed: file size: ${ fileData.progressEl.max } received: ${ fileData.progressEl.value }`;
				fileData.spanEl.innerHTML = status;
			}
			fileData.spanEl.hidden = false;
			thisPeer.send( Brume.encodeMsg( { type: 'result', data: status } ) );
			await writableStream.close();
			writableStream = null;
			break;

		case 'ready':
			readerStartTime = readerStartTime == undefined ? Date.now() : readerStartTime;
			if( value == undefined ) {
				( { done, value } = await readableStream.read() );
				if( !done ){
					begin = 0, end = MAX_SEND_SIZE;
				} else {
					thisPeer.send( Brume.encodeMsg( { type: 'eof' } ) );
					break;
				}
			}

			const data = Array.from( value.slice ( begin, end ) );
			thisPeer.send( Brume.encodeMsg( { type: 'chunk', data } ) );
			fileData.progressEl.value += data.length;
			begin += MAX_SEND_SIZE, end += MAX_SEND_SIZE;
			if( begin > value.length ) { value = undefined, begin = 0, end = MAX_SEND_SIZE; }
			break;

		case 'result':
			if( msg.data.includes( 'failed ' ) ) fileData.spanEl.innerHTML = 'transfer failed';
			fileData.spanEl.hidden = false;
			delete sendFilesData[ fileData.fileHandle.name ];
			writableStream = null;
			readableStream = null;

			if( Object.keys( sendFilesData ).length > 0 ){
				fileData = Object.values( sendFilesData )[0];
				const f = await fileData.fileHandle.getFile();
				readableStream = f.stream().getReader();
				fileData.progressEl.max = f.size;
				fileData.progressEl.value = 0;
				fileData.progressEl.hidden = false;
				readerStartTime = undefined;
				thisPeer.send( Brume.encodeMsg( { type: 'start', data: { name: fileData.fileHandle.name, size: f.size } } ) );
				delete sendFilesData[ fileData.fileHandle.name ];
			} else {
				transferDoneButton.classList.remove( 'hidden'  );
			}
			break;

		case 'done':
			transferAppCleanup();
			break;

		default:
	}
}

const openFiles = async () => {
	if ( "showOpenFilePicker" in window && window.self === window.top ) {
		let files = [];
		try {
			files = await window.showOpenFilePicker( { multiple: true, startIn } );
			startIn = files[0];
		} catch ( err ) {
			if ( err.name !== 'AbortError' ) console.error( err.name, err.message );
		}
		return files;
	}

	// Fallback if the File System Access API is not supported.
	return new Promise( ( resolve ) => {
		const input = document.createElement( 'input' );
		input.style.display = 'none';
		input.type = 'file';
		document.body.append( input );
		input.addEventListener( 'change', () => {
			input.remove();
			resolve( input.files ? input.files : [] );
		} );
		if( 'showPicker' in HTMLInputElement.prototype ){
			input.showPicker();
		} else {
			input.click();
		}
	} );
};

acceptButton.addEventListener( 'click', async () => {
	let fileHandle = undefined;
	let rejectedFiles = [];
	for( const file of offeredFilesList.getElementsByTagName( 'li' ) ){
		if( file.querySelector( 'input' ).checked ){
			fileHandle = await window.showSaveFilePicker( { suggestedName: file.textContent, startIn } );
			startIn = fileHandle;
			offeredFilesData[file.textContent].fileHandle = fileHandle;
		} else {
			rejectedFiles.push( file.textContent );
		}
		file.querySelector( 'input' ).disabled = true;
	}
	thisPeer.send( Brume.encodeMsg( { type: 'rejectedFiles', data: rejectedFiles } ) );
	acceptButton.disabled = true;
	transferDoneButton.classList.remove( 'hidden'  );
} );

selectButton.addEventListener( 'click', async () => {
	const fileHandles = await openFiles();
	if( fileHandles?.length === 0 ) return;
	for( const fileHandle of  fileHandles ){
		const { liEl, cbEl, progressEl, spanEl } = fileListEntry( fileHandle.name );
		sendFilesData[fileHandle.name] = { fileHandle, cbEl, progressEl, spanEl };
		sendFilesList.appendChild( liEl );
	}
} );

sendButton.addEventListener( 'click', () => {
	const files = Object.keys( sendFilesData );
	files.forEach( file => sendFilesData[file].cbEl.disabled = true );
	thisPeer.send( Brume.encodeMsg( { type: 'offeredFiles', data: files  } ) );
	sendButton.disabled = true;
	selectButton.disabled = true;
	return;
} );

transferAppButton.addEventListener( 'click', () => {
	transferAppButton.classList.add( 'hidden' );
	transferAppDiv.classList.remove( 'hidden' );
	transferDoneButton.classList.remove( 'hidden'  );
	sendFilesDiv.classList.remove( 'hidden'  );
} );

transferDoneButton.addEventListener( 'click', ( e ) => { transferAppCleanup( 'button' ); } );

function transferApp( peer ){
	peer.on( 'data', dataHandler );
	thisPeer = peer;
}

function transferAppCleanup( source ){
	sendFilesList.innerHTML = '';
	offeredFilesList.innerHTML = '';
	sendFilesData = {};
	offeredFilesData = {};
	offeredFilesDiv.classList.add( 'hidden'  );
	sendFilesDiv.classList.add( 'hidden'  ); //false;
	transferDoneButton.classList.add( 'hidden'  );
	transferAppDiv.classList.add( 'hidden'  );
	transferAppButton.classList.remove( 'hidden'  );
	sendButton.disabled = false;
	selectButton.disabled = false;
	acceptButton.disabled = false;
	if( source === 'button' )thisPeer.send( Brume.encodeMsg( { type: 'done', data: null } ) );
}
