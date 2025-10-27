import * as nsfwjs from 'nsfwjs';
import * as tf from '@tensorflow/tfjs';

export interface NSFWPrediction {
  isNSFW: boolean;
  confidence: number;
  predictions: nsfwjs.PredictionType[];
}

class NSFWDetector {
  private model: nsfwjs.NSFWJS | null = null;
  private isLoading = false;

  async init() {
    if (this.model || this.isLoading) return;

    this.isLoading = true;
    try {
      // Set backend to WebGL for better performance
      await tf.setBackend('webgl');
      await tf.ready();

      console.log('Loading NSFW model...');
      this.model = await nsfwjs.load();
      console.log('NSFW model loaded successfully');
    } catch (error) {
      console.error('Error loading NSFW model:', error);
      throw error;
    } finally {
      this.isLoading = false;
    }
  }

  async classify(videoElement: HTMLVideoElement): Promise<NSFWPrediction> {
    if (!this.model) {
      throw new Error('Model not initialized. Call init() first.');
    }

    try {
      const predictions = await this.model.classify(videoElement);
      
      // Calculate NSFW score (sum of Porn, Sexy, and Hentai)
      const nsfwScore = predictions.reduce((sum, pred) => {
        if (['Porn', 'Sexy', 'Hentai'].includes(pred.className)) {
          return sum + pred.probability;
        }
        return sum;
      }, 0);

      const isNSFW = nsfwScore > 0.8; // Threshold from requirements

      return {
        isNSFW,
        confidence: nsfwScore,
        predictions,
      };
    } catch (error) {
      console.error('Error classifying video:', error);
      throw error;
    }
  }

  isReady(): boolean {
    return this.model !== null;
  }
}

// Singleton instance
export const nsfwDetector = new NSFWDetector();
