import React, { useState, useEffect } from 'react';
import { GIPHY_API_KEY } from '../config/stickers';

const StickerPicker = ({ onSelectGif, onClose }) => {
  const [gifs, setGifs] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchGifs('trending');
  }, []);

  const fetchGifs = async (query) => {
    setLoading(true);
    try {
      const endpoint = query === 'trending' 
        ? `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=20&rating=g`
        : `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${query}&limit=20&rating=g`;
      
      const res = await fetch(endpoint);
      const data = await res.json();
      if (data.data) {
        setGifs(data.data);
      }
    } catch (err) {
      console.error("Giphy fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchChange = (e) => {
    setSearch(e.target.value);
    const timeoutId = setTimeout(() => {
      if (e.target.value.trim()) {
        fetchGifs(e.target.value);
      } else {
        fetchGifs('trending');
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  };

  return (
    <div className="sticker-picker-popover glass-panel">
      <div className="picker-tabs">
        <button className="active" style={{ cursor: 'default' }}>GIFs</button>
      </div>

      <div className="picker-content">
        <div className="gif-picker-container">
          <div className="gif-search">
            <input 
              type="text" 
              placeholder="Search GIPHY..." 
              value={search}
              onChange={handleSearchChange}
              autoFocus
            />
          </div>
          {loading ? (
            <div className="loader" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>Searching...</div>
          ) : (
            <div className="gif-grid">
              {gifs.map(gif => (
                <div 
                  key={gif.id} 
                  className="gif-item"
                  onClick={() => {
                    onSelectGif(gif.images.fixed_height.url);
                    onClose();
                  }}
                >
                  <img src={gif.images.fixed_height_small.url} alt={gif.title} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StickerPicker;
