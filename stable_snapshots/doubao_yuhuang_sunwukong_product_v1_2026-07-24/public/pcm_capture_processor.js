'use strict';

class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channelData = inputs[0] && inputs[0][0];

    if (!channelData || channelData.length === 0) {
      return true;
    }

    const copiedBuffer = new Float32Array(channelData);
    this.port.postMessage(copiedBuffer, [copiedBuffer.buffer]);
    return true;
  }
}

registerProcessor(
  'pcm-capture-processor',
  PcmCaptureProcessor
);
