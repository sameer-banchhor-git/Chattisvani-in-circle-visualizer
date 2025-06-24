

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {LitElement, css, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {Analyser} from './analyser';

@customElement('gdm-circle-visualizer')
export class GdmCircleVisualizer extends LitElement {
  @property({attribute: false}) inputNode?: AudioNode;
  @property({attribute: false}) outputNode?: AudioNode;

  @state() private inputAnalyser?: Analyser;
  @state() private outputAnalyser?: Analyser;

  private canvas!: HTMLCanvasElement;
  private canvasCtx!: CanvasRenderingContext2D;
  private animationFrameId?: number;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
    canvas {
      width: 100%;
      height: 100%;
      display: block;
      background-color: #ffffff; /* White background for canvas */
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    if (this.inputNode && !this.inputAnalyser) {
      this.inputAnalyser = new Analyser(this.inputNode);
    }
    if (this.outputNode && !this.outputAnalyser) {
      this.outputAnalyser = new Analyser(this.outputNode);
    }
    this.startVisualization();
    window.addEventListener('resize', this.handleResize);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    window.removeEventListener('resize', this.handleResize);
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    if (changedProperties.has('inputNode') && this.inputNode) {
      this.inputAnalyser = new Analyser(this.inputNode);
      this.startVisualization();
    }
    if (changedProperties.has('outputNode') && this.outputNode) {
      this.outputAnalyser = new Analyser(this.outputNode);
      this.startVisualization();
    }
  }

  private handleResize = () => {
    this.setupCanvas();
    // No need to explicitly call visualize here, as setupCanvas might be enough
    // and visualize is already in an animation loop.
    // If drawing becomes static on resize, we might need to kick a draw cycle.
  };

  private setupCanvas() {
    if (!this.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    
    // Check if context already exists and is valid
    if (!this.canvasCtx) {
        this.canvasCtx = this.canvas.getContext('2d')!;
    }
    
    // If context is still null (e.g., canvas not in DOM yet or other issues), bail
    if (!this.canvasCtx) return;

    // Apply scaling for HiDPI displays.
    this.canvasCtx.resetTransform(); // Clear previous transforms
    this.canvasCtx.scale(dpr, dpr);
  }

  private startVisualization() {
    // Ensure canvas and context are ready before starting the loop
    if (!this.canvas || !this.canvasCtx) {
        if (this.shadowRoot?.querySelector('canvas')) {
            this.canvas = this.shadowRoot.querySelector('canvas')!;
            this.setupCanvas(); // setupCanvas will try to get context
        }
        // If still not ready, try again
        if (!this.canvasCtx) {
            requestAnimationFrame(() => this.startVisualization());
            return;
        }
    }

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.visualize();
  }

  private visualize = () => {
    if (!this.canvasCtx || (!this.inputAnalyser && !this.outputAnalyser)) {
      this.animationFrameId = requestAnimationFrame(this.visualize);
      return;
    }

    // Use logical pixel dimensions for drawing calculations
    const logicalWidth = this.canvas.width / (window.devicePixelRatio || 1);
    const logicalHeight = this.canvas.height / (window.devicePixelRatio || 1);
    
    const centerX = logicalWidth / 2;
    const centerY = logicalHeight / 2;

    this.canvasCtx.fillStyle = '#ffffff'; // White background
    // Fill with logical dimensions, as context is scaled
    this.canvasCtx.fillRect(0, 0, logicalWidth, logicalHeight);

    const baseRadiusMultiplier = Math.min(logicalWidth, logicalHeight) * 0.15;
    const barHeightMultiplier = Math.min(logicalWidth, logicalHeight) * 0.1;
    const barWidth = 2; // Logical pixels for bar width

    // Draw Output Analyser (Outer circle - Bot)
    if (this.outputAnalyser) {
      this.outputAnalyser.update();
      const outputData = this.outputAnalyser.data;
      const numBars = outputData.length; // Should be 128 with fftSize 256
      const outerRadius = baseRadiusMultiplier * 2; 
      const maxBarHeight = barHeightMultiplier * 1.5; 

      this.canvasCtx.strokeStyle = '#1E90FF'; // Electric Blue for output bars (Bot)
      this.canvasCtx.lineWidth = barWidth;

      for (let i = 0; i < numBars; i++) {
        const barHeight = (outputData[i] / 255) * maxBarHeight;
        const angle = (i / numBars) * 2 * Math.PI - Math.PI / 2; // Start from top

        const startX = centerX + outerRadius * Math.cos(angle);
        const startY = centerY + outerRadius * Math.sin(angle);
        const endX = centerX + (outerRadius + barHeight) * Math.cos(angle);
        const endY = centerY + (outerRadius + barHeight) * Math.sin(angle);

        this.canvasCtx.beginPath();
        this.canvasCtx.moveTo(startX, startY);
        this.canvasCtx.lineTo(endX, endY);
        this.canvasCtx.stroke();
      }
    }

    // Draw Input Analyser (Inner circle - User)
    if (this.inputAnalyser) {
      this.inputAnalyser.update();
      const inputData = this.inputAnalyser.data;
      const numBars = inputData.length; // Should be 128
      const innerRadius = baseRadiusMultiplier; 
      const maxBarHeight = barHeightMultiplier; 

      this.canvasCtx.strokeStyle = '#000000'; // Black for input bars (User)
      this.canvasCtx.lineWidth = barWidth;

      for (let i = 0; i < numBars; i++) {
        const barHeight = (inputData[i] / 255) * maxBarHeight;
        const angle = (i / numBars) * 2 * Math.PI - Math.PI / 2; // Start from top

        const startX = centerX + innerRadius * Math.cos(angle);
        const startY = centerY + innerRadius * Math.sin(angle);
        const endX = centerX + (innerRadius + barHeight) * Math.cos(angle);
        const endY = centerY + (innerRadius + barHeight) * Math.sin(angle);

        this.canvasCtx.beginPath();
        this.canvasCtx.moveTo(startX, startY);
        this.canvasCtx.lineTo(endX, endY);
        this.canvasCtx.stroke();
      }
    }
    this.animationFrameId = requestAnimationFrame(this.visualize);
  };

  firstUpdated() {
    this.canvas = this.shadowRoot!.querySelector('canvas')!;
    this.setupCanvas(); // This will get context and set initial scaling
    // Visualization will be started by connectedCallback or updated
    // after analysers are potentially set.
  }

  render() {
    return html`<canvas></canvas>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gdm-circle-visualizer': GdmCircleVisualizer;
  }
}
