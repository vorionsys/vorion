# agentanchor.MarketplaceApi

All URIs are relative to *https://app.agentanchorai.com/api/v1*

Method | HTTP request | Description
------------- | ------------- | -------------
[**acquire_agent**](MarketplaceApi.md#acquire_agent) | **POST** /marketplace/acquisitions | Acquire agent
[**create_marketplace_listing**](MarketplaceApi.md#create_marketplace_listing) | **POST** /marketplace/listings | Create listing
[**list_acquisitions**](MarketplaceApi.md#list_acquisitions) | **GET** /marketplace/acquisitions | List acquisitions
[**list_marketplace_listings**](MarketplaceApi.md#list_marketplace_listings) | **GET** /marketplace/listings | Browse listings


# **acquire_agent**
> AcquireAgent201Response acquire_agent(acquire_agent_request)

Acquire agent

Acquire an agent from the marketplace.

### Example

* Bearer Authentication (BearerAuth):

```python
import agentanchor
from agentanchor.models.acquire_agent201_response import AcquireAgent201Response
from agentanchor.models.acquire_agent_request import AcquireAgentRequest
from agentanchor.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://app.agentanchorai.com/api/v1
# See configuration.py for a list of all supported configuration parameters.
configuration = agentanchor.Configuration(
    host = "https://app.agentanchorai.com/api/v1"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure Bearer authorization: BearerAuth
configuration = agentanchor.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with agentanchor.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = agentanchor.MarketplaceApi(api_client)
    acquire_agent_request = agentanchor.AcquireAgentRequest() # AcquireAgentRequest | 

    try:
        # Acquire agent
        api_response = api_instance.acquire_agent(acquire_agent_request)
        print("The response of MarketplaceApi->acquire_agent:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling MarketplaceApi->acquire_agent: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **acquire_agent_request** | [**AcquireAgentRequest**](AcquireAgentRequest.md)|  | 

### Return type

[**AcquireAgent201Response**](AcquireAgent201Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Acquisition created |  -  |
**401** | Invalid or missing API key |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **create_marketplace_listing**
> CreateMarketplaceListing201Response create_marketplace_listing(create_marketplace_listing_request)

Create listing

Create a new marketplace listing for an agent.

### Example

* Bearer Authentication (BearerAuth):

```python
import agentanchor
from agentanchor.models.create_marketplace_listing201_response import CreateMarketplaceListing201Response
from agentanchor.models.create_marketplace_listing_request import CreateMarketplaceListingRequest
from agentanchor.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://app.agentanchorai.com/api/v1
# See configuration.py for a list of all supported configuration parameters.
configuration = agentanchor.Configuration(
    host = "https://app.agentanchorai.com/api/v1"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure Bearer authorization: BearerAuth
configuration = agentanchor.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with agentanchor.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = agentanchor.MarketplaceApi(api_client)
    create_marketplace_listing_request = agentanchor.CreateMarketplaceListingRequest() # CreateMarketplaceListingRequest | 

    try:
        # Create listing
        api_response = api_instance.create_marketplace_listing(create_marketplace_listing_request)
        print("The response of MarketplaceApi->create_marketplace_listing:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling MarketplaceApi->create_marketplace_listing: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **create_marketplace_listing_request** | [**CreateMarketplaceListingRequest**](CreateMarketplaceListingRequest.md)|  | 

### Return type

[**CreateMarketplaceListing201Response**](CreateMarketplaceListing201Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Created listing |  -  |
**401** | Invalid or missing API key |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_acquisitions**
> ListAcquisitions200Response list_acquisitions(status=status)

List acquisitions

List agent acquisitions for the authenticated user.

### Example

* Bearer Authentication (BearerAuth):

```python
import agentanchor
from agentanchor.models.list_acquisitions200_response import ListAcquisitions200Response
from agentanchor.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://app.agentanchorai.com/api/v1
# See configuration.py for a list of all supported configuration parameters.
configuration = agentanchor.Configuration(
    host = "https://app.agentanchorai.com/api/v1"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure Bearer authorization: BearerAuth
configuration = agentanchor.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with agentanchor.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = agentanchor.MarketplaceApi(api_client)
    status = 'status_example' # str |  (optional)

    try:
        # List acquisitions
        api_response = api_instance.list_acquisitions(status=status)
        print("The response of MarketplaceApi->list_acquisitions:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling MarketplaceApi->list_acquisitions: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **status** | **str**|  | [optional] 

### Return type

[**ListAcquisitions200Response**](ListAcquisitions200Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of acquisitions |  -  |
**401** | Invalid or missing API key |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_marketplace_listings**
> ListMarketplaceListings200Response list_marketplace_listings(q=q, category=category, min_trust=min_trust, price_type=price_type, sort=sort, page=page, limit=limit)

Browse listings

Search and filter marketplace agent listings.

### Example


```python
import agentanchor
from agentanchor.models.list_marketplace_listings200_response import ListMarketplaceListings200Response
from agentanchor.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://app.agentanchorai.com/api/v1
# See configuration.py for a list of all supported configuration parameters.
configuration = agentanchor.Configuration(
    host = "https://app.agentanchorai.com/api/v1"
)


# Enter a context with an instance of the API client
with agentanchor.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = agentanchor.MarketplaceApi(api_client)
    q = 'q_example' # str | Search query (optional)
    category = 'category_example' # str |  (optional)
    min_trust = 56 # int |  (optional)
    price_type = 'price_type_example' # str |  (optional)
    sort = 'sort_example' # str |  (optional)
    page = 1 # int |  (optional) (default to 1)
    limit = 20 # int |  (optional) (default to 20)

    try:
        # Browse listings
        api_response = api_instance.list_marketplace_listings(q=q, category=category, min_trust=min_trust, price_type=price_type, sort=sort, page=page, limit=limit)
        print("The response of MarketplaceApi->list_marketplace_listings:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling MarketplaceApi->list_marketplace_listings: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **q** | **str**| Search query | [optional] 
 **category** | **str**|  | [optional] 
 **min_trust** | **int**|  | [optional] 
 **price_type** | **str**|  | [optional] 
 **sort** | **str**|  | [optional] 
 **page** | **int**|  | [optional] [default to 1]
 **limit** | **int**|  | [optional] [default to 20]

### Return type

[**ListMarketplaceListings200Response**](ListMarketplaceListings200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of marketplace listings |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

