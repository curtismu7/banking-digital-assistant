import { useEffect, useState } from 'react';

const useChatWidget = () => {
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // Check if the global widget is available
    const checkForWidget = () => {
      if (window.bankingWidget) {
        setIsInitialized(true);
        return true;
      }
      return false;
    };

    // Check immediately
    if (checkForWidget()) {
      return;
    }

    // If not available, poll for it
    const interval = setInterval(() => {
      if (checkForWidget()) {
        clearInterval(interval);
      }
    }, 100);

    // Clean up interval after 10 seconds
    const timeout = setTimeout(() => {
      clearInterval(interval);
      console.warn('Banking chat widget not found after 10 seconds');
    }, 10000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);

  // Return widget control methods that use the global widget
  return {
    open: () => {
      console.log('Attempting to open chat widget...');
      console.log('window.bankingWidget:', window.bankingWidget);
      console.log('window.initBankingChatWidget:', window.initBankingChatWidget);
      
      if (window.bankingWidget) {
        try {
          // Check DOM before opening
          console.log('🔍 DOM elements before open:', {
            chatWidgets: document.querySelectorAll('[id*="chat"]'),
            bankingWidgets: document.querySelectorAll('[id*="banking"]'),
            allWidgets: document.querySelectorAll('[class*="widget"], [id*="widget"]')
          });
          
          window.bankingWidget.open();
          console.log('Chat widget opened successfully');
          
          // Check DOM after opening
          setTimeout(() => {
            const chatWidgets = document.querySelectorAll('[id*="chat"]');
            const bankingWidgets = document.querySelectorAll('[id*="banking"]');
            const allWidgets = document.querySelectorAll('[class*="widget"], [id*="widget"]');
            
            console.log('🔍 DOM elements after open:', {
              chatWidgets,
              bankingWidgets,
              allWidgets,
              hiddenElements: document.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"]')
            });
            
            // Inspect each widget element in detail
            [...chatWidgets, ...bankingWidgets, ...allWidgets].forEach((el, index) => {
              const styles = window.getComputedStyle(el);
              console.log(`🔍 Widget element ${index}:`, {
                element: el,
                id: el.id,
                className: el.className,
                innerHTML: el.innerHTML.substring(0, 200) + '...',
                styles: {
                  display: styles.display,
                  visibility: styles.visibility,
                  opacity: styles.opacity,
                  position: styles.position,
                  zIndex: styles.zIndex,
                  top: styles.top,
                  right: styles.right,
                  bottom: styles.bottom,
                  left: styles.left,
                  width: styles.width,
                  height: styles.height,
                  transform: styles.transform
                }
              });
              
              // Try to make it visible and positioned
              if (el.id.includes('banking') || el.id.includes('chat')) {
                console.log(`🔧 Attempting to fix widget ${index}...`);
                el.style.position = 'fixed';
                el.style.bottom = '20px';
                el.style.right = '20px';
                el.style.zIndex = '10000';
                el.style.display = 'block';
                el.style.visibility = 'visible';
                el.style.opacity = '1';
                el.style.width = '350px';
                el.style.height = '500px';
                el.style.backgroundColor = 'white';
                el.style.border = '2px solid #007bff';
                el.style.borderRadius = '12px';
                el.style.boxShadow = '0 8px 32px rgba(0,0,0,0.2)';
                console.log(`✅ Applied fixes to widget ${index}`);
              }
            });
            
            // Check for elements with high z-index that might be covering
            const highZElements = Array.from(document.querySelectorAll('*')).filter(el => {
              const zIndex = window.getComputedStyle(el).zIndex;
              return zIndex && parseInt(zIndex) > 1000;
            });
            console.log('🔍 High z-index elements:', highZElements);
            
            // Look for any elements that might be the chat widget
            const possibleWidgets = document.querySelectorAll('div[style*="position: fixed"], div[style*="position: absolute"]');
            console.log('🔍 Fixed/absolute positioned elements:', possibleWidgets);
          }, 100);
          
        } catch (error) {
          console.error('Error opening chat widget:', error);
        }
      } else {
        console.warn('Banking chat widget not available');
        // Try to initialize if the function exists but widget wasn't created
        if (window.initBankingChatWidget) {
          console.log('Attempting to initialize widget now...');
          try {
            const widget = window.initBankingChatWidget({
              apiUrl: 'ws://localhost:8082/ws',
              position: 'bottom-right',
              theme: 'light',
              title: 'AI Banking Assistant',
              autoOpen: true // Open immediately when created
            });
            window.bankingWidget = widget;
            setIsInitialized(true);
          } catch (error) {
            console.error('Failed to initialize widget:', error);
          }
        }
      }
    },
    close: () => {
      if (window.bankingWidget) {
        try {
          window.bankingWidget.close();
        } catch (error) {
          console.error('Error closing chat widget:', error);
        }
      } else {
        console.warn('Banking chat widget not available');
      }
    },
    destroy: () => {
      if (window.bankingWidget) {
        try {
          window.bankingWidget.destroy();
          window.bankingWidget = null;
          setIsInitialized(false);
        } catch (error) {
          console.error('Error destroying chat widget:', error);
        }
      }
    },
    isInitialized: () => isInitialized
  };
};

export default useChatWidget;